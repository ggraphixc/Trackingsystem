/*
 * Dravex Tag V2 — hardware test mode (implementation).
 *
 * Production mode is the default (CONFIG_DRAVEX_TAG_TEST_MODE=n). Test mode
 * is a compile-time dev/bench feature; all overrides come from Kconfig so a
 * production build can never enable them accidentally.
 */

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

#include "tag_test.h"

LOG_MODULE_REGISTER(dravex_tag_test, LOG_LEVEL_INF);

bool tag_test_enabled(void)
{
	return IS_ENABLED(CONFIG_DRAVEX_TAG_TEST_MODE);
}

uint32_t tag_test_day_offset(void)
{
	return tag_test_enabled() ? CONFIG_DRAVEX_TAG_TEST_DAY_OFFSET : 0;
}

int32_t tag_test_burst_ms(void)
{
	return tag_test_enabled() ? CONFIG_DRAVEX_TAG_TEST_BURST_MS : 0;
}

int32_t tag_test_sleep_ms(void)
{
	return tag_test_enabled() ? CONFIG_DRAVEX_TAG_TEST_SLEEP_MS : 0;
}

void tag_test_log_boot(const char *id_hex, const struct tag_batt_state *batt,
		       bool armed)
{
	if (!tag_test_enabled()) {
		return;
	}
	LOG_INF("[test] permanent id (dev UART only, never BLE): %s",
		id_hex);
	if (batt) {
		LOG_INF("[test] battery: mv=%d pct=%d low=%d", batt->mv,
			batt->percent, batt->low ? 1 : 0);
	}
	LOG_INF("[test] armed=%d mode=%s", armed ? 1 : 0,
		IS_ENABLED(CONFIG_DRAVEX_TAG_TEST_MODE) ? "TEST" : "PROD");
}
