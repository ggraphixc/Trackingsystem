/*
 * Dravex Tag V2 — hardware test mode.
 *
 * Enabled ONLY by CONFIG_DRAVEX_TAG_TEST_MODE (default n — production mode
 * is the default). Test mode is for the bench: it logs the permanent
 * identity and battery through the DEBUG UART (the secure development
 * interface), allows an immediate beacon rotation, and overrides the duty
 * cycle timings. It NEVER changes what goes into BLE packets beyond the
 * (still day-derived) beacon, and it never exposes the permanent secret
 * over the air.
 */

#ifndef TAG_TEST_H
#define TAG_TEST_H

#include <stdint.h>
#include <stdbool.h>

#include "tag_batt.h"

/** True when CONFIG_DRAVEX_TAG_TEST_MODE is set. */
bool tag_test_enabled(void);

/**
 * Day offset applied to the rotation bucket in test mode (0 = none).
 * Lets a developer force the beacon to change immediately without waiting
 * for midnight — the resulting beacon intentionally won't resolve on the
 * live server (it is a future day); it proves the rotation mechanics.
 */
uint32_t tag_test_day_offset(void);

/** Advertising-burst override (ms); 0 = use production config. */
int32_t tag_test_burst_ms(void);

/** Deep-sleep override (ms); 0 = use production config. */
int32_t tag_test_sleep_ms(void);

/**
 * Boot diagnostics over the debug UART only: permanent identity hex,
 * battery state, armed state. Never transmitted over BLE.
 */
void tag_test_log_boot(const char *id_hex, const struct tag_batt_state *batt,
		       bool armed);

#endif /* TAG_TEST_H */
