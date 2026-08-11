import type { Device, Incident } from "./types";

export const NPF_CHANNELS = [
  { label: "NPF Cybercrime e-portal", value: "nccc.npf.gov.ng", href: "https://nccc.npf.gov.ng" },
  { label: "Citizen Reporting Portal (CRP)", value: "crp.ng · USSD *121# · SMS 121", href: "https://crp.ng" },
  { label: "Nearest police station", value: "visit in person with ID + proof of purchase" },
];

export const SEED_DEVICES: Device[] = [
  {
    id: "dev-1",
    brand: "Dell",
    model: "XPS 15 9530",
    serialNumber: "XPS9530-B7F2K1",
    color: "Platinum Silver",
    ownerName: "Ada Obi",
    phone: "0803 123 4567",
    registeredAt: "2026-06-12T09:30:00Z",
    status: "protected",
    lastKnown: {
      lat: 6.5244,
      lng: 3.3792,
      accuracy: 40,
      source: "wifi",
      ipAddress: "105.112.44.201",
      timestamp: "2026-08-09T18:40:00Z",
      confidence: 82,
    },
  },
  {
    id: "dev-2",
    brand: "HP",
    model: "EliteBook 840 G9",
    serialNumber: "HP840G9-CN4487X",
    color: "Silver",
    ownerName: "Ada Obi",
    phone: "0803 123 4567",
    registeredAt: "2026-05-02T14:00:00Z",
    status: "lost",
    lastKnown: {
      lat: 6.6018,
      lng: 3.3515,
      accuracy: 1200,
      source: "ip",
      ipAddress: "102.89.32.118",
      timestamp: "2026-08-01T20:15:00Z",
      confidence: 55,
    },
  },
  {
    id: "dev-3",
    brand: "Lenovo",
    model: "ThinkPad T14 Gen 3",
    serialNumber: "T14G3-PF3L9D8",
    color: "Black",
    ownerName: "Chinedu Eze",
    phone: "0812 555 8899",
    registeredAt: "2026-07-20T11:10:00Z",
    status: "recovered",
    lastKnown: {
      lat: 6.4531,
      lng: 3.3958,
      accuracy: 35,
      source: "wifi",
      ipAddress: "105.112.87.44",
      timestamp: "2026-08-05T16:00:00Z",
      confidence: 85,
    },
  },
];

export const SEED_INCIDENTS: Incident[] = [
  {
    id: "inc-1",
    deviceId: "dev-2",
    serialNumber: "HP840G9-CN4487X",
    deviceLabel: "HP EliteBook 840 G9 · Silver",
    dateLost: "2026-08-01T19:45:00Z",
    locationLost: "Computer Village, Ikeja, Lagos",
    story: "Stolen from a repair bench while the owner stepped away to take a call.",
    status: "reported",
    registryRef: "SR-2026-88912",
    policeRef: "CRP-2026-88912",
    createdAt: "2026-08-01T21:30:00Z",
    steps: [
      { label: "Report to police (NPF NCCC / CRP)", done: true, doneAt: "2026-08-01T22:00:00Z" },
      { label: "List serial in the stolen registry", done: true, doneAt: "2026-08-02T09:15:00Z" },
      { label: "Community registry + sightings", done: false },
      { label: "Recovery or insurance claim pack", done: false },
    ],
  },
  {
    id: "inc-2",
    deviceId: "dev-3",
    serialNumber: "T14G3-PF3L9D8",
    deviceLabel: "Lenovo ThinkPad T14 Gen 3 · Black",
    dateLost: "2026-07-28T13:10:00Z",
    locationLost: "Ojuelegba, Lagos",
    story: "Left in a danfo (bus) and couldn't find it when I got off.",
    status: "recovered",
    registryRef: "SR-2026-77101",
    policeRef: "CRP-2026-77101",
    createdAt: "2026-07-28T14:00:00Z",
    steps: [
      { label: "Report to police (NPF NCCC / CRP)", done: true, doneAt: "2026-07-28T14:30:00Z" },
      { label: "List serial in the stolen registry", done: true, doneAt: "2026-07-28T15:00:00Z" },
      { label: "Community registry + sightings", done: true, doneAt: "2026-08-05T16:00:00Z" },
      { label: "Recovery or insurance claim pack", done: true, doneAt: "2026-08-05T16:05:00Z" },
    ],
  },
];

export const STOLEN_SERIAL_DB: Record<string, { brand: string; model: string; status: "clean" | "reported_stolen"; reportedAt?: string }> = {
  "HP840G9-CN4487X": { brand: "HP", model: "EliteBook 840 G9", status: "reported_stolen", reportedAt: "2026-08-01" },
};

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
