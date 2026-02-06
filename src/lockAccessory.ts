import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import { AugustLockPlatform } from './platform.js';
import type { AugustAPILockDetailed, AugustLockContext, AugustLockStatus } from './types.js';

// @ts-expect-error August API has no types
import August from 'august-api';

export class AugustLockAccessory {
  private lockService: Service;
  private batteryService: Service;
  private unsubscribeFromAPI: () => void;

  private readonly securedState: number;
  private readonly unsecuredState: number;

  constructor(
    private readonly platform: AugustLockPlatform,
    private readonly accessory: PlatformAccessory<AugustLockContext>,
    private augustClient: August,
  ){
    this.securedState = this.platform.Characteristic.LockCurrentState.SECURED;
    this.unsecuredState = this.platform.Characteristic.LockCurrentState.UNSECURED;

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'August')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.serial);

    this.lockService = this.accessory.getService(this.platform.Service.LockMechanism) || this.accessory.addService(this.platform.Service.LockMechanism);
    this.batteryService = this.accessory.getService(this.platform.Service.Battery) || this.accessory.addService(this.platform.Service.Battery);

    // set inintial battery state
    this.updateBatteryCharacteristics();
    this.batteryService.updateCharacteristic(this.platform.Characteristic.ChargingState, this.platform.Characteristic.ChargingState.NOT_CHARGEABLE);
    
    // set initial lock state
    this.lockService.updateCharacteristic(this.platform.Characteristic.Name, accessory.context.name);
    this.updateLockCharacteristics();

    //
    // register battery handlers
    //
    this.batteryService.getCharacteristic(this.platform.Characteristic.BatteryLevel)
      .onGet(() => {
        return this.accessory.context.BatteryLevel;
      });

    this.batteryService.getCharacteristic(this.platform.Characteristic.StatusLowBattery)
      .onGet(() => {
        return this.accessory.context.BatteryLevel <= 15
          ? this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
          : this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
      });

    //
    // register handlers for LockCurrentState
    //
    this.lockService.getCharacteristic(this.platform.Characteristic.LockCurrentState)
      .onGet(() => {
        return this.accessory.context.LockCurrentState;
      });

    //
    // register handlers for LockTargetState
    //
    this.lockService.getCharacteristic(this.platform.Characteristic.LockTargetState)
      .onGet(() => {
        return this.accessory.context.LockTargetState;
      })
      .onSet(this.handleLockTargetStateSet.bind(this));

    // subscribe to updates
    this.unsubscribeFromAPI = this.augustClient.subscribe(this.accessory.context.id, (lockStatus: AugustLockStatus) => {
      const subscriptionState = this.getStateFromStatus(lockStatus);
      if( subscriptionState === null ) {
        this.platform.log.warn(`Received subscription update for lock ${this.accessory.context.name} without a usable state`);
        return;
      }

      const subscriptionLabel = subscriptionState === this.securedState ? 'locked' : 'unlocked';
      this.platform.log.debug(`Received subscription update for lock ${this.accessory.context.name}: ${subscriptionLabel}`);
      this.applyLockState(subscriptionState);
    });
  }

  updateBatteryCharacteristics() {
    this.batteryService.updateCharacteristic(this.platform.Characteristic.BatteryLevel, this.accessory.context.BatteryLevel);
    this.batteryService.updateCharacteristic(this.platform.Characteristic.StatusLowBattery,
      this.accessory.context.BatteryLevel <= 15
        ? this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
        : this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
    );
  }

  updateLockCharacteristics() {
    // set initial lock state
    this.lockService.updateCharacteristic(this.platform.Characteristic.LockCurrentState, this.accessory.context.LockCurrentState);
    this.lockService.updateCharacteristic(this.platform.Characteristic.LockTargetState, this.accessory.context.LockTargetState);
  }

  private getStateFromStatus(lockStatus: AugustLockStatus): number | null {
    if( typeof lockStatus?.state?.locked === 'boolean' ) {
      return lockStatus.state.locked ? this.securedState : this.unsecuredState;
    }

    if( lockStatus?.status === 'kAugLockState_Locked' ) {
      return this.securedState;
    }

    if( lockStatus?.status === 'kAugLockState_Unlocked' ) {
      return this.unsecuredState;
    }

    return null;
  }

  private applyLockState(nextState: number) {
    this.accessory.context.LockCurrentState = nextState;
    this.accessory.context.LockTargetState = nextState;

    this.lockService.updateCharacteristic(this.platform.Characteristic.LockCurrentState, nextState);
    this.lockService.updateCharacteristic(this.platform.Characteristic.LockTargetState, nextState);
  }

  private async getCurrentLockStateFromDetails() {
    const locks = await this.augustClient.details() as AugustAPILockDetailed[];
    const lock = locks.find((details) => details.LockID === this.accessory.context.id);
    if( !lock ) {
      return null;
    }

    return lock.LockStatus.status === 'locked'
      ? this.securedState
      : this.unsecuredState;
  }

  /**
   * Handle requests to set the "Lock Target State" characteristic
   */
  async handleLockTargetStateSet(value: CharacteristicValue) {
    const desiredState = value as number;
    this.accessory.context.LockTargetState = desiredState;
    this.lockService.updateCharacteristic(this.platform.Characteristic.LockTargetState, desiredState);

    if( this.accessory.context.LockTargetState === this.accessory.context.LockCurrentState ) {
      // No change needed
      return;
    }

    try {
      let lockStatus: AugustLockStatus;

      if( desiredState === this.platform.Characteristic.LockTargetState.SECURED ) {
        lockStatus = await this.augustClient.lock(this.accessory.context.id) as AugustLockStatus;
      } else {
        lockStatus = await this.augustClient.unlock(this.accessory.context.id) as AugustLockStatus;
      }

      const resolvedState = this.getStateFromStatus(lockStatus) ?? await this.getCurrentLockStateFromDetails();

      if( resolvedState === null ) {
        this.platform.log.warn(`Unable to resolve final lock state for ${this.accessory.context.name} after command`);
        return;
      }

      this.applyLockState(resolvedState);
    } catch (error) {
      this.platform.log.error(`Failed to set lock state for ${this.accessory.context.name}`, error);
      throw error;
    }
  }
}
