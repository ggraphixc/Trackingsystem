/*
 * Dravex Tag V2 — time-aware beacon rotation (implementation).
 *
 * Rotation scheme (documented in DRAVEX_NEXTGENE.md §19):
 *
 *   epoch_day  = floor(now_utc / 86400)
 *   beacon     = hex(sha256(secret_hex + "|" + epoch_day))[0..12]
 *
 * `secret_hex` is the tag's permanent 12-hex NVS identity — it is NEVER
 * transmitted over BLE; only the rotated beacon is broadcast, and it changes
 * at every UTC day boundary. The server tries today + yesterday, so a valid
 * beacon resolves and yesterday's expires naturally.
 *
 * Time: absolute epoch-day comes from an RTC (devicetree alias `drax_rtc`)
 * using the Zephyr `rtc_get_time` API. When no RTC is present,
 * tag_rotation_epoch_day() returns -ENOTSUP and the tag fails CLOSED (quiet
 * + error LED) — it never invents time and never falls back to a permanent
 * broadcast id.
 */

#include <zephyr/kernel.h>
#include <zephyr/settings/settings.h>
#include <tinycrypt/sha256.h>
#include <string.h>

#include "tag_rotation.h"

/* Only when the board overlay wires an RTC and RTC support is enabled. */
#if defined(CONFIG_RTC) && DT_NODE_EXISTS(DT_ALIAS(drax_rtc))
#include <zephyr/drivers/rtc.h>
#define TAG_HAS_RTC 1
#else
#define TAG_HAS_RTC 0
#endif

static const char hex_chars[] = "0123456789abcdef";

int tag_rotation_epoch_day(uint32_t *day_out)
{
#if TAG_HAS_RTC
	const struct device *rtc_dev = DEVICE_DT_GET(DT_ALIAS(drax_rtc));
	struct rtc_time tm;

	if (!device_is_ready(rtc_dev)) {
		return -ENODEV;
	}
	if (rtc_get_time(rtc_dev, &tm) != 0) {
		return -EIO;
	}
	/*
	 * Days since the Unix epoch from a civil date (Howard Hinnant's
	 * days_from_civil). The server's dayBucket() uses the same UTC epoch
	 * day, so the tag and the server always land on the same boundary.
	 */
	int32_t y = (int32_t)tm.tm_year;
	int32_t m = (int32_t)tm.tm_mon + 1; /* Zephyr rtc_time is 0-based */
	int32_t d = (int32_t)tm.tm_mday;
	y -= (m <= 2);
	const int32_t era = (y >= 0 ? y : y - 399) / 400;
	const unsigned int yoe = (unsigned int)(y - era * 400);
	const unsigned int doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
	const unsigned int doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
	*day_out = (uint32_t)(era * 146097 + (int32_t)doe - 719468);
	return 0;
#else
	(void)day_out;
	return -ENOTSUP;
#endif
}

void tag_rotation_derive(const char *secret_hex, uint32_t day,
			 char *beacon_hex_out)
{
	struct tc_sha256_state_struct ctx;
	uint8_t digest[32];
	char input[16 + 1 + 10 + 1]; /* 12-hex secret + "|" + day (max 10 digits) */

	snprintk(input, sizeof(input), "%s|%u", secret_hex, (unsigned int)day);

	(void)tc_sha256_init(&ctx);
	(void)tc_sha256_update(&ctx, (const uint8_t *)input, strlen(input));
	(void)tc_sha256_final(digest, &ctx);

	for (int i = 0; i < TAG_BEACON_HEX_LEN / 2; i++) {
		beacon_hex_out[i * 2] = hex_chars[digest[i] >> 4];
		beacon_hex_out[i * 2 + 1] = hex_chars[digest[i] & 0x0f];
	}
	beacon_hex_out[TAG_BEACON_HEX_LEN] = '\0';
}
