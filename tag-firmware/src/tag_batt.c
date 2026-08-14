/*
 * Dravex Tag V2 — battery telemetry (implementation).
 *
 * A CR2032 cell through a resistor divider on an ADC channel. The board
 * overlay wires the sense pin as devicetree alias `batt_vbat`; without it
 * (nRF52840 DK prototype) the state is TAG_BATT_UNKNOWN and `low` stays
 * false — no fabricated numbers.
 *
 * The percentage is a coarse linear estimate over the CR2032's usable range
 * (~3.0–2.0 V under load). It is an ESTIMATE, not a measured discharge
 * curve — the README says so, and production calibration requires real
 * hardware testing.
 */

#include <zephyr/kernel.h>
#include <zephyr/device.h>
#include <zephyr/drivers/adc.h>
#include <string.h>

#include "tag_batt.h"

#if DT_NODE_EXISTS(DT_ALIAS(batt_vbat))
#define TAG_HAS_BATT 1
#else
#define TAG_HAS_BATT 0
#endif

/* CR2032 estimate: 3.0 V full … 2.0 V flat. Adjust with real hardware. */
#define TAG_BATT_FULL_MV 3000
#define TAG_BATT_FLAT_MV 2000
#define TAG_BATT_LOW_MV 2300

#if TAG_HAS_BATT
static const struct adc_dt_spec batt =
	ADC_DT_SPEC_GET(DT_ALIAS(batt_vbat));
#endif

void tag_batt_read(struct tag_batt_state *out)
{
	memset(out, 0, sizeof(*out));
	out->mv = TAG_BATT_UNKNOWN;
	out->percent = TAG_BATT_UNKNOWN;

#if TAG_HAS_BATT
	int16_t sample = 0;
	int err;

	if (!device_is_ready(batt.dev)) {
		return;
	}
	err = adc_channel_setup_dt(&batt);
	if (err != 0) {
		return;
	}
	err = adc_read_dt(&batt, &sample);
	if (err != 0) {
		return;
	}
	/* adc_raw_to_millivolts handles the gain/reference configured in dts. */
	int32_t mv;
	err = adc_raw_to_millivolts_dt(&batt, &sample, &mv);
	if (err != 0) {
		return;
	}
	out->mv = mv;
	if (mv <= TAG_BATT_FULL_MV) {
		int32_t span = TAG_BATT_FULL_MV - TAG_BATT_FLAT_MV;
		int32_t pct = (mv - TAG_BATT_FLAT_MV) * 100 / span;
		out->percent = pct < 0 ? 0 : (pct > 100 ? 100 : pct);
	}
	out->low = mv <= TAG_BATT_LOW_MV;
#endif
}
