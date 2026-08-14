/*
 * Dravex Tag V2 — time-aware beacon rotation.
 *
 * The tag NEVER broadcasts its permanent identity (the 6-byte NVS secret).
 * Instead it broadcasts a day-rotated beacon:
 *
 *   beacon = hex(sha256(secret_hex + "|" + epoch_day))[0..12]
 *
 * which is the same derivation family as the Android agent
 * (server/beacon.js: beaconFor(deviceId, dayBucket)), keyed on the tag's
 * permanent secret instead of the deviceId. The server resolves it by
 * trying today and yesterday for every device that carries a staticBeacon
 * (see server/beacon.js resolveBeacon) — so a valid beacon always resolves,
 * yesterday's expires naturally, and no listener can follow the tag across
 * days or replay an old beacon.
 *
 * Time source (fail-safe by design):
 *   - An RTC wired as devicetree alias `drax_rtc` (e.g. NXP PCF85063 on I2C,
 *     battery-backed) provides the absolute epoch day via rtc_get_time().
 *   - WITHOUT an RTC the tag CANNOT know the current epoch day. It fails
 *     closed: it refuses to advertise (even when armed) and signals ERROR,
 *     rather than inventing time or broadcasting a permanent id. A
 *     production tag therefore requires a battery-backed RTC; the nRF52840
 *     DK (no RTC) demonstrates everything except rotation and is used for
 *     development/test mode.
 *
 * The rotation math is mirrored exactly by server/e2e-tag.js so the C and
 * the server can never drift apart.
 */

#ifndef TAG_ROTATION_H
#define TAG_ROTATION_H

#include <stdint.h>
#include <stddef.h>

#define TAG_BEACON_HEX_LEN 12
#define TAG_BEACON_HEX_BUF (TAG_BEACON_HEX_LEN + 1)

/**
 * Current absolute epoch day (UTC, floor(now / 86400 s)) — the rotation
 * bucket. Returns 0 and -ENOTSUP when no RTC time source is available.
 */
int tag_rotation_epoch_day(uint32_t *day_out);

/**
 * Derive the day-rotated beacon for a secret + day. `secret_hex` is the
 * 12-char lowercase hex permanent secret; `beacon_hex_out` must be at least
 * TAG_BEACON_HEX_BUF bytes. Deterministic — same secret + day → same beacon.
 */
void tag_rotation_derive(const char *secret_hex, uint32_t day,
			 char *beacon_hex_out);

#endif /* TAG_ROTATION_H */
