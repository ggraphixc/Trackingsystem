/*
 * Dravex Tag V2 — battery telemetry.
 *
 * Measured ONLY when the board provides a battery sense node wired as the
 * devicetree alias `batt_vbat` (an ADC channel through a resistor divider to
 * the coin cell). On boards without it (the nRF52840 DK prototype has no
 * battery input) every call reports TAG_BATT_UNKNOWN — the firmware never
 * fabricates a voltage or percentage.
 */

#ifndef TAG_BATT_H
#define TAG_BATT_H

#include <stdint.h>

#define TAG_BATT_UNKNOWN -1

struct tag_batt_state {
	/** Millivolts, or TAG_BATT_UNKNOWN when not measurable. */
	int32_t mv;
	/** 0–100, or TAG_BATT_UNKNOWN. */
	int32_t percent;
	/** True only when mv is measurable and below the low threshold. */
	bool low;
};

/** Read the battery once. Callers should rate-limit (ADC draws current). */
void tag_batt_read(struct tag_batt_state *out);

#endif /* TAG_BATT_H */
