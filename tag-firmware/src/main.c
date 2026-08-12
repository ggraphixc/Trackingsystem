/*
 * Dravex Tag — recovery beacon firmware (Zephyr / nRF52840).
 *
 * Broadcasts the same Dravex beacon format as the Android agent
 * (service UUID 0000fffa-0000-1000-8000-00805f9b34fb, service data =
 * [0x01] + 12 ASCII hex chars), so every existing Dravex phone and desktop
 * scanner already hears it — zero protocol changes.
 *
 * Privacy-first: the tag is SILENT until armed. Long-press (>= 2 s) the
 * button to arm (broadcast starts, LED on); long-press again to disarm.
 * The 12-hex identity is generated once on first boot and persisted in NVS,
 * so it survives reboots and battery swaps. Pair it in the dashboard by
 * claiming a pairing code with `staticBeacon: <the 12-hex id>` — see
 * tag-firmware/README.md.
 *
 * Build:  west build -b nrf52840dk_nrf52840 tag-firmware
 */

#include <zephyr/kernel.h>
#include <zephyr/device.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/adv.h>
#include <zephyr/settings/settings.h>
#include <zephyr/random/rand32.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h> /* ARRAY_SIZE, BIT */
#include <string.h>

LOG_MODULE_REGISTER(dravex_tag, LOG_LEVEL_INF);

/* ---------------- identity ---------------- */

#define TAG_ID_BYTES 6
#define TAG_ID_HEX_LEN 12

static uint8_t tag_id[TAG_ID_BYTES];
static char tag_id_hex[TAG_ID_HEX_LEN + 1];
static bool id_loaded;

static const char hex_chars[] = "0123456789abcdef";

static int settings_load_id(const char *key, size_t len, settings_read_cb read_cb,
			    void *cb_arg)
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

/* ---------------- advertising ---------------- */

#define BT_UUID_DRAVEX_SVC 0xfffa

static const struct bt_uuid_128 dravex_uuid =
	BT_UUID_128_INIT(BT_UUID_128_ENCODE(0x0000fffa, 0x00001000, 0x80000080,
					    0x5f9b34fb));

static uint8_t svc_data[13]; /* [0x01] + 12 hex chars */
static struct bt_data adv_data[2];
static struct bt_le_ext_adv *adv_set;

static const struct bt_le_adv_param adv_param =
	BT_LE_ADV_PARAM_INIT(BT_LE_ADV_OPT_ONE_TIME, BT_GAP_ADV_SLOW_INT_MIN,
			     BT_GAP_ADV_SLOW_INT_MAX, NULL);

static void build_adv_data(void)
{
	svc_data[0] = 0x01; /* beacon version 1 — matches Beacon.kt */
	memcpy(&svc_data[1], tag_id_hex, TAG_ID_HEX_LEN);

	adv_data[0] = (struct bt_data)BT_DATA(BT_DATA_UUID128_ALL,
					      dravex_uuid.val, 16);
	adv_data[1] = (struct bt_data)BT_DATA(BT_DATA_SVC_DATA128, svc_data,
					      sizeof(svc_data));
}

static int adv_init(void)
{
	int err;

	err = bt_le_ext_adv_create(&adv_param, NULL, &adv_set);
	if (err) {
		LOG_ERR("adv create failed: %d", err);
		return err;
	}
	err = bt_le_ext_adv_set_data(adv_set, adv_data, ARRAY_SIZE(adv_data),
				     NULL, 0);
	if (err) {
		LOG_ERR("adv data failed: %d", err);
		return err;
	}
	return 0;
}

/* ---------------- armed state + button ---------------- */

static bool armed;

static void set_armed(bool on)
{
	int err;

	if (on == armed) {
		return;
	}
	armed = on;
	if (on) {
		err = bt_le_ext_adv_start(adv_set, BT_LE_EXT_ADV_START_DEFAULT);
		if (err) {
			LOG_ERR("adv start failed: %d", err);
			return;
		}
		LOG_INF("ARMED — broadcasting beacon %s", tag_id_hex);
	} else {
		(void)bt_le_ext_adv_stop(adv_set);
		LOG_INF("disarmed — silent");
	}
}

static const struct gpio_dt_spec btn = GPIO_DT_SPEC_GET(DT_ALIAS(btn0), gpios);
static const struct gpio_dt_spec led = GPIO_DT_SPEC_GET(DT_ALIAS(led0), gpios);

/* nRF52840 DK buttons are active-low (pulled up, pressed = 0). */
static bool pressed_now(void)
{
	return gpio_pin_get_dt(&btn) == 0;
}

static bool btn_down;
static int64_t press_start_ms;
static struct k_work_delayable debounce_work;
static struct gpio_callback btn_cb;

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
		if (held_ms >= 2000) {
			set_armed(!armed);
		}
	}
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

	LOG_INF("Dravex Tag starting");

	err = bt_enable(NULL);
	if (err) {
		LOG_ERR("BT init failed: %d", err);
		return;
	}

	load_or_create_id();
	build_adv_data();

	err = adv_init();
	if (err) {
		return;
	}

	setup_gpio();

	LOG_INF("Ready — tag id %s. Long-press the button (>= 2 s) to arm.", tag_id_hex);
}
