export type DeviceStatus = "protected" | "lost" | "recovered";
export type IncidentStatus = "reported" | "sighted" | "recovered" | "closed";
export type FixSource = "wifi" | "ip" | "last_known";

export interface LocationFix {
  lat: number;
  lng: number;
  accuracy: number; // meters
  source: FixSource;
  ipAddress?: string;
  timestamp: string; // ISO
  confidence: number; // 0–100
}

export interface Device {
  id: string;
  brand: string;
  model: string;
  /** phone | laptop */
  type: "phone" | "laptop";
  /** Laptop serial number / asset tag (laptops have no IMEI). */
  serialNumber?: string;
  /** Phone IMEI (phones have no serial number). */
  imei?: string;
  color?: string;
  ownerName: string;
  phone: string;
  registeredAt: string; // ISO
  status: DeviceStatus;
  lastKnown?: LocationFix;
}

export interface IncidentStep {
  label: string;
  done: boolean;
  doneAt?: string;
}

export interface Incident {
  id: string;
  deviceId: string;
  serialNumber: string;
  deviceLabel: string;
  dateLost: string; // ISO
  locationLost: string;
  story: string;
  status: IncidentStatus;
  registryRef?: string;
  policeRef?: string;
  createdAt: string;
  steps: IncidentStep[];
}

export interface SerialLookupResult {
  found: boolean;
  brand?: string;
  model?: string;
  status?: "clean" | "reported_stolen";
  reportedAt?: string;
  message: string;
}
