/*
 * Dravex Tag V2 — centralized timing / power configuration.
 *
 * All duty-cycle and advertising knobs live here (or in Kconfig behind the
 * same symbols) so a firmware tuning pass touches exactly one place. Values
 * are DEFAULTS; production tuning must be validated on real hardware.
 *
 * Battery-life figures below are ESTIMATES (typical CR2032 ≈ 220 mAh):
 * they are not measured and must not be quoted as product claims until
 * bench-tested.
 */

#ifndef TAG_CONFIG_H
#define TAG_CONFIG_H

#include <stdint.h>

/* Kconfig-backed defaults (see Kconfig). 0 means "use the built-in default". */
#ifndef CONFIG_DRAVEX_TAG_ADV_BURST_MS
#define CONFIG_DRAVEX_TAG_ADV_BURST_MS 0
#endif
#ifndef CONFIG_DRAVEX_TAG_SLEEP_MS
#define CONFIG_DRAVEX_TAG_SLEEP_MS 0
#endif
#ifndef CONFIG_DRAVEX_TAG_ADV_INT_MIN_MS
#define CONFIG_DRAVEX_TAG_ADV_INT_MIN_MS 0
#endif
#ifndef CONFIG_DRAVEX_TAG_ADV_INT_MAX_MS
#define CONFIG_DRAVEX_TAG_ADV_INT_MAX_MS 0
#endif

struct tag_timing {
	/** ms the radio advertises per cycle before sleeping. */
	uint32_t adv_burst_ms;
	/** ms of deep sleep between bursts. */
	uint32_t sleep_ms;
	/** Advertising interval range (ms) — 0.625 ms units at the BLE layer. */
	uint32_t adv_int_min_ms;
	uint32_t adv_int_max_ms;
	/**
	 * Controller TX power (dBm) — informational. The actual power is set
	 * by the BLE controller Kconfig (e.g. CONFIG_BT_CTLR_TX_PWR_*), kept
	 * in prj.conf so power tuning is also centralized.
	 */
	int8_t tx_power_dbm;
};

/*
 * Built-in defaults (used when the matching Kconfig is 0).
 *
 *   burst 250 ms → sleep 5 s  ≈ 5% radio duty while armed.
 *   advertising 100 ms–150 ms (fast discovery burst).
 *
 * Armed battery estimate: a 5% duty burst on a CR2032 is on the order of
 * WEEKS, not days — but this is an estimate; real drain (radio + RTC +
 * regulator + LED) must be measured on the bench before quoting numbers.
 * Disarmed the tag sleeps deeply and draws only leakage (RTC + system-off
 * quiescent), which is the point: the tag is quiet until armed.
 */
#define TAG_TIMING_DEFAULT_BURST_MS 250u
#define TAG_TIMING_DEFAULT_SLEEP_MS 5000u
#define TAG_TIMING_DEFAULT_ADV_INT_MIN_MS 100u
#define TAG_TIMING_DEFAULT_ADV_INT_MAX_MS 150u
#define TAG_TIMING_DEFAULT_TX_POWER_DBM 0

/** Resolve the effective timing: Kconfig override, else the defaults. */
static inline struct tag_timing tag_timing_get(void)
{
	struct tag_timing t;

	t.adv_burst_ms = CONFIG_DRAVEX_TAG_ADV_BURST_MS
				 ? CONFIG_DRAVEX_TAG_ADV_BURST_MS
				 : TAG_TIMING_DEFAULT_BURST_MS;
	t.sleep_ms = CONFIG_DRAVEX_TAG_SLEEP_MS
			     ? CONFIG_DRAVEX_TAG_SLEEP_MS
			     : TAG_TIMING_DEFAULT_SLEEP_MS;
	t.adv_int_min_ms = CONFIG_DRAVEX_TAG_ADV_INT_MIN_MS
				   ? CONFIG_DRAVEX_TAG_ADV_INT_MIN_MS
				   : TAG_TIMING_DEFAULT_ADV_INT_MIN_MS;
	t.adv_int_max_ms = CONFIG_DRAVEX_TAG_ADV_INT_MAX_MS
				   ? CONFIG_DRAVEX_TAG_ADV_INT_MAX_MS
				   : TAG_TIMING_DEFAULT_ADV_INT_MAX_MS;
	t.tx_power_dbm = TAG_TIMING_DEFAULT_TX_POWER_DBM;

	/* Test-mode timing overrides (bench only). */
#if defined(CONFIG_DRAVEX_TAG_TEST_MODE) && CONFIG_DRAVEX_TAG_TEST_MODE
	if (CONFIG_DRAVEX_TAG_TEST_BURST_MS > 0) {
		t.adv_burst_ms = CONFIG_DRAVEX_TAG_TEST_BURST_MS;
	}
	if (CONFIG_DRAVEX_TAG_TEST_SLEEP_MS > 0) {
		t.sleep_ms = CONFIG_DRAVEX_TAG_TEST_SLEEP_MS;
	}
#endif

	return t;
}

#endif /* TAG_CONFIG_H */
