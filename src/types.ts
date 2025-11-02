export type AugustLockContext = {
  id: string
  name: string
  LockCurrentState: number
  LockTargetState: number
  BatteryLevel: number
  model: string
  serial: string
}

type DateTimeISO = string; // Assuming ISO date string
type BatteryLevel = number; // Assuming battery level is a number

type AugustOfflineKey = {
  created: DateTimeISO,
  key: string,
  slot: number,
  UserID: string
}

type AugustUser = {
  UserType: string
  FirstName: string,
  LastName: string,
  identifiers: string[]
}

export type AugustLockStatus = {
  lockID: string
  status: 'kAugLockState_Locked' | 'kAugLockState_Unlocked'
  state: {
    locked: boolean,
    unlocked: boolean,
    closed: boolean,
    open: boolean,
  }
}

export type AugustAPILockDetailed = {
  LockName: string;
  Type: number;
  Created: DateTimeISO;
  Updated: DateTimeISO;
  LockID: string;
  HouseID: string;
  HouseName: string;
  Calibrated: boolean;
  timeZone: string;
  battery: BatteryLevel;
  batteryInfo: {
    level: BatteryLevel;
    warningState: string;
    infoUpdatedDate: DateTimeISO;
    lastChangeDate: DateTimeISO;
    lastChangeVoltage: number;
  };
  supportsEntryCodes: boolean;
  remoteOperateSecret: string;
  HomeKitSetupPayload: string;
  skuNumber: string;
  macAddress: string;
  SerialNumber: string;
  LockStatus: {
    status: 'locked' | 'unlocked';
    dateTime: DateTimeISO;
    isLockStatusChanged: boolean;
    valid: boolean;
    doorState: 'open' | 'closed';
  };
  currentFirmwareVersion: string;
  homeKitEnabled: boolean;
  zWaveEnabled: boolean;
  isGalileo: boolean;
  Bridge: {
    _id: string;
    mfgBridgeID: string;
    deviceModel: string;
    firmwareVersion: string;
    operative: boolean;
    status: {
      current: string;
      lastOffline: DateTimeISO;
      updated: DateTimeISO;
      lastOnline: DateTimeISO;
    };
    locks: Array<{
      _id: string;
      LockID: string;
      macAddress: string;
    }>;
    hyperBridge: boolean;
  };
  OfflineKeys: {
    created: AugustOfflineKey[];
    loaded: AugustOfflineKey[];
    deleted: AugustOfflineKey[];
    createdhk: AugustOfflineKey[];
  };
  parametersToSet: Record<string, unknown>;
  users: Record<string, AugustUser>;
  pubsubChannel: string;
  ruleHash: Record<string, unknown>;
  cameras: unknown[];
  geofenceLimits: {
    ios: {
      debounceInterval: number;
      gpsAccuracyMultiplier: number;
      maximumGeofence: number;
      minimumGeofence: number;
      minGPSAccuracyRequired: number;
    };
  };
};