/*
 * Dravex Tag V2 — production recovery beacon firmware (Zephyr / nRF52840).
 *
 * Broadcasts the SAME Dravex beacon format as the Android agent (service
 * UUID 0000fffa-0000-1000-8000-00805f9b34fb, service data = [0x01] + 12 hex
 * chars), so every existing Dravex phone/desktop scanner already hears it —
 * zero protocol changes.
 *
 * V2 vs the prototype:
 *   - The permanent identity (6 bytes, NVS) is NEVER broadcast. What the
 *     tag advertises is a day-rotated beacon derived from that secret
 *     (tag_rotation.c) — no permanent BLE tracking identifier.
 *   - Time-aware rotation needs a battery-backed RTC (devicetree alias
 *     `drax_rtc`). Without one the tag FAILS CLOSED: it refuses to advertise
 *     and signals ERROR instead of inventing time (DRAVEX_NEXTGENE §19).
 *   - Duty cycle: SLEEP → WAKE → ADVERTISE(burst) → SLEEP, driven by a
 *     dedicated thread with the CPU parked in STANDBY between bursts
 *     (tag_config.h holds every timing knob in one place).
 *   - Button: short press = status pulse; long press (>= 2 s) = arm/disarm.
 *     The tag is DISARMED / QUIET by default — it advertises only while
 *     armed, and a reboot re-arms nothing (fail-safe).
 *   - Battery telemetry (tag_batt.c) is measured only on boards that wire
 *     the `batt_vbat` ADC alias; otherwise honestly UNKNOWN.
 *   - Test mode (CONFIG_DRAVEX_TAG_TEST_MODE, default n) is a bench-only
 *     feature; it never changes the BLE privacy model.
 *
 * Build:  west build -b nrf52840dk_nrf52840 tag-firmware
 *         west flash
 */

#include <zephyr/kernel.h>
#include <zephyr/device.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/adv.h>
#include <zephyr/settings/settings.h>
#include <zephyr/random/rand32.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h> /* ARRAY_SIZE, BIT, IS_ENABLED */
#include <string.h>

#if defined(CONFIG_PM)
#include <zephyr/pm/pm.h>
#include <zephyr/pm/state.h>
#endif

#include "tag_rotation.h"
#include "tag_batt.h"
#include "tag_config.h"
#include "tag_test.h"

LOG_MODULE_REGISTER(dravex_tag, LOG_LEVEL_INF);

/* ---------------- identity (persistent, never broadcast) ---------------- */

#define TAG_ID_BYTES 6
#define TAG_ID_HEX_LEN 12

static uint8_t tag_id[TAG_ID_BYTES];
static char tag_id_hex[TAG_ID_HEX_LEN + 1];
static bool id_loaded;

static const char hex_chars[] = "0123456789abcdef";

static int settings_load_id(const char *key, size_t len,
			    settings_read_cb read_cb, void *cb_arg)
{
	if (!strcmp(key, "id")) {
		if (len != TAG_ID_BYTES) {
			return -EINVAL;
		}
		ssize_t n = read_cb(cb_arg, tag_id, TAG_ID_BYTES);
		if (n == TAG_ID_BYTES) {
			id_loaded = true;
			return 0;
		}
		return -EINVAL;
	}
	return 0;
}

SETTINGS_STATIC_HANDLER_DEFINE(tag, "tag", NULL, settings_load_id, NULL, NULL);

static void hex_encode(void)
{
	for (int i = 0; i < TAG_ID_BYTES; i++) {
		tag_id_hex[i * 2] = hex_chars[tag_id[i] >> 4];
		tag_id_hex[i * 2 + 1] = hex_chars[tag_id[i] & 0x0f];
	}
	tag_id_hex[TAG_ID_HEX_LEN] = '\0';
}

static void load_or_create_id(void)
{
	settings_load();

	if (!id_loaded) {
		sys_rand_get(tag_id, sizeof(tag_id));
		settings_save_one("tag/id", tag_id, sizeof(tag_id));
		LOG_INF("Generated new tag id");
	}
	hex_encode();
}

/* ---------------- advertising (extended, day-rotated beacon) -------------- */

#define BT_UUID_DRAVEX_SVC 0xfffa

static const struct bt_uuid_128 dravex_uuid =
	BT_UUID_128_INIT(BT_UUID_128_ENCODE(0x0000fffa, 0x00001000, 0x80000080,
					    0x5f9b34fb));

static uint8_t svc_data[13]; /* [0x01] + 12 hex chars */
static struct bt_data adv_data[2];
static struct bt_le_ext_adv *adv_set;

static struct tag_timing timing;

/* Convert a central timing (ms) into the BLE 0.625 ms unit. */
#define MS_TO_BT(x) ((x) * 8u)

static void build_adv_data(const char *beacon_hex)
{
	svc_data[0] = 0x01; /* beacon version 1 — matches Beacon.kt */
	memcpy(&svc_data[1], beacon_hex, TAG_BEACON_HEX_LEN);

	adv_data[0] = (struct bt_data)BT_DATA(BT_DATA_UUID128_ALL,
					      dravex_uuid.val, 16);
	adv_data[1] = (struct bt_data)BT_DATA(BT_DATA_SVC_DATA128, svc_data,
					      sizeof(svc_data));
}

static int adv_init(void)
{
	int err;

	err = bt_le_ext_adv_create(NULL, NULL, &adv_set);
	if (err) {
		LOG_ERR("adv create failed: %d", err);
		return err;
	}
	return 0;
}

/* ---------------- LED status (short pulses — battery friendly) ------------ */

static const struct gpio_dt_spec led = GPIO_DT_SPEC_GET(DT_ALIAS(led0), gpios);
static const struct gpio_dt_spec btn = GPIO_DT_SPEC_GET(DT_ALIAS(btn0), gpios);

static void led_on(void)
{
	if (gpio_is_ready_dt(&led)) {
		gpio_pin_set_dt(&led, 1);
	}
}

static void led_off(void)
{
	if (gpio_is_ready_dt(&led)) {
		gpio_pin_set_dt(&led, 0);
	}
}

/* Short blocking pulse train — used only from the button work item. */
static void led_pulse(int pulses, int ms_on, int ms_gap)
{
	for (int i = 0; i < pulses; i++) {
		led_on();
		k_msleep(ms_on);
		led_off();
		if (i + 1 < pulses) {
			k_msleep(ms_gap);
		}
	}
}

static void led_status(bool now_armed, const struct tag_batt_state *batt)
{
	/* armed: 2 quick pulses · disarmed: 1 · +1 slow pulse when low. */
	int pulses = now_armed ? 2 : 1;
	int tail = (batt && batt->low) ? 1 : 0;

	led_pulse(pulses, 60, 120);
	if (tail) {
		k_msleep(200);
		led_pulse(1, 400, 0);
	}
}

static void led_error(void)
{
	led_pulse(4, 150, 150);
}

/* ---------------- armed state + duty cycle ---------------- */

static bool armed;

static struct k_sem armed_sem;

static void set_armed(bool on)
{
	if (on == armed) {
		return;
	}
	armed = on;
	if (on) {
		k_sem_give(&armed_sem);
		LOG_INF("ARMED — broadcasting day-rotated beacon");
	} else {
		(void)bt_le_ext_adv_stop(adv_set);
		led_off();
		LOG_INF("disarmed — silent");
	}
}

/*
 * Dedicated thread: SLEEP → WAKE → ADVERTISE(burst) → SLEEP. The beacon is
 * re-derived every cycle, so the id rotates automatically at the UTC day
 * boundary while armed. Between bursts the CPU is parked in STANDBY (RTC
 * keeps running, so the kernel timer wakes it; the nRF52840 draws ~1 µA).
 */
K_THREAD_STACK_DEFINE(adv_stack, 1024);
static struct k_thread adv_thread_data;

static void adv_cycle_entry(void *a, void *b, void *c)
{
	(void)a;
	(void)b;
	(void)c;

	for (;;) {
		if (!armed) {
			k_sem_take(&armed_sem, K_FOREVER);
			continue;
		}

		uint32_t day = 0;
		int err = tag_rotation_epoch_day(&day);

		if (err != 0) {
			/* No RTC → fail closed: never broadcast a wrong id. */
			LOG_ERR("no time source — cannot rotate beacon safely");
			set_armed(false);
			led_error();
			continue;
		}
		/* Test mode may force an immediate rotation (bench only). */
		day += tag_test_day_offset();

		char beacon_hex[TAG_BEACON_HEX_BUF];
		tag_rotation_derive(tag_id_hex, day, beacon_hex);
		build_adv_data(beacon_hex);
		(void)bt_le_ext_adv_set_data(adv_set, adv_data,
					     ARRAY_SIZE(adv_data), NULL, 0);

		(void)bt_le_ext_adv_start(adv_set, BT_LE_EXT_ADV_START_DEFAULT);
		led_on(); /* visible with the burst — a soft blink, not a strobe */
		k_sleep(K_MSEC(timing.adv_burst_ms));
		(void)bt_le_ext_adv_stop(adv_set);
		led_off();

		/* Park in STANDBY until the next burst (kernel timer wakes us). */
		k_sleep(K_MSEC(timing.sleep_ms));
	}
}

/* ---------------- button (short = status, long = arm/disarm) -------------- */

static struct k_work_delayable debounce_work;
static struct gpio_callback btn_cb;
static bool btn_down;
static int64_t press_start_ms;

#define PRESS_SHORT_MAX_MS 1000
#define PRESS_LONG_MIN_MS 2000

static bool pressed_now(void); /* fwd — defined below with the GPIO block */

static void debounce_fn(struct k_work *work)
{
	bool down = pressed_now();

	if (down == btn_down) {
		return;
	}
	btn_down = down;
	if (down) {
		press_start_ms = k_uptime_get();
	} else {
		int64_t held_ms = k_uptime_get() - press_start_ms;
		struct tag_batt_state batt;

		tag_batt_read(&batt); /* may be UNKNOWN — led_status handles it */
		if (held_ms >= PRESS_LONG_MIN_MS) {
			set_armed(!armed);
			/* Feedback after toggling: 2 pulses if armed, 1 if not. */
			led_status(armed, &batt);
		} else if (held_ms < PRESS_SHORT_MAX_MS) {
			LOG_INF("status: armed=%d batt_mv=%d pct=%d low=%d",
				armed ? 1 : 0, batt.mv, batt.percent,
				batt.low ? 1 : 0);
			led_status(armed, &batt);
		}
	}
}

static bool pressed_now(void)
{
	/* nRF52840 DK buttons are active-low (pulled up, pressed = 0). */
	return gpio_pin_get_dt(&btn) == 0;
}

static void btn_isr(const struct device *dev, struct gpio_callback *cb,
		    uint32_t pins)
{
	k_work_schedule(&debounce_work, K_MSEC(50));
}

static void setup_gpio(void)
{
	int err;

	if (!gpio_is_ready_dt(&btn)) {
		LOG_WRN("button not ready");
		return;
	}
	err = gpio_pin_configure_dt(&btn, GPIO_INPUT | GPIO_PULL_UP);
	if (err) {
		LOG_ERR("button config failed: %d", err);
		return;
	}
	gpio_init_callback(&btn_cb, btn_isr, BIT(btn.pin));
	err = gpio_add_callback(btn.port, &btn_cb);
	if (err) {
		LOG_ERR("button callback failed: %d", err);
		return;
	}
	err = gpio_pin_interrupt_configure_dt(&btn, GPIO_INT_EDGE_BOTH);
	if (err) {
		LOG_ERR("button irq failed: %d", err);
		return;
	}
	k_work_init_delayable(&debounce_work, debounce_fn);

	if (gpio_is_ready_dt(&led)) {
		gpio_pin_configure_dt(&led, GPIO_OUTPUT_INACTIVE);
	}
}

/* ---------------- main ---------------- */

void main(void)
{
	int err;

	LOG_INF("Dravex Tag V2 starting");

	err = bt_enable(NULL);
	if (err) {
		LOG_ERR("BT init failed: %d", err);
		return;
	}

	load_or_create_id();
	timing = tag_timing_get();

	err = adv_init();
	if (err) {
		return;
	}

	/* One-time check: warn loudly when the board has no RTC time source. */
	uint32_t day = 0;
	if (tag_rotation_epoch_day(&day) != 0) {
		LOG_WRN("no RTC time source — arming will fail closed (see "
			"DRAVEX_NEXTGENE §19 / DRAVEX_TAG_V2.md)");
	}

#if defined(CONFIG_PM)
	/* Park idle time in STANDBY: RTC stays alive so k_sleep timers fire. */
	pm_state_force(0, &(struct pm_state_info){ PM_STATE_STANDBY });
#endif

	setup_gpio();

	k_sem_init(&armed_sem, 0, 1);
	k_thread_create(&adv_thread_data, adv_stack, K_THREAD_STACK_SIZEOF(adv_stack),
			adv_cycle_entry, NULL, NULL, NULL,
			K_PRIO_PREEMPT(7), 0, K_NO_WAIT);
	k_thread_name_set(&adv_thread_data, "adv_cycle");

	struct tag_batt_state batt;
	tag_batt_read(&batt);

	/* Default state: DISARMED / QUIET. A reboot never re-arms (fail-safe). */
	armed = false;

	tag_test_log_boot(tag_id_hex, &batt, armed);

	LOG_INF("Ready — tag %s. Short press: status. Long press (>= 2 s): "
		"arm/disarm. Default: disarmed (silent).",
		tag_id_hex);
}
