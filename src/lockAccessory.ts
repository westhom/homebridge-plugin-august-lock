import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import { AugustLockPlatform } from './platform.js';
import type { AugustLockContext, AugustLockStatus } from './types.js';

// @ts-expect-error August API has no types
import August from 'august-api';

export class AugustLockAccessory {
  private lockService: Service;
  private batteryService: Service;
  private unsubscribeFromAPI: () => void;

  constructor(
    private readonly platform: AugustLockPlatform,
    private readonly accessory: PlatformAccessory<AugustLockContext>,
    private augustClient: August,
  ){
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
      this.platform.log.debug(`Received subscription update for lock ${this.accessory.context.name}: locked = ${lockStatus.state.locked}`);
      
      const subscriptionState = lockStatus.state.locked ? 1 : 0;
      if( this.accessory.context.LockCurrentState === subscriptionState ) {
        return;
      }

      this.accessory.context.LockCurrentState = subscriptionState;
      this.lockService.updateCharacteristic(this.platform.Characteristic.LockCurrentState, subscriptionState);
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

  /**
   * Handle requests to set the "Lock Target State" characteristic
   */
  async handleLockTargetStateSet(value: CharacteristicValue) {
    this.accessory.context.LockTargetState = value as number;

    if( this.accessory.context.LockTargetState === this.accessory.context.LockCurrentState ) {
      // No change needed
      return;
    }

    let lockStatus: AugustLockStatus;

    if( value === this.platform.Characteristic.LockTargetState.SECURED ) {
      lockStatus = await this.augustClient.lock(this.accessory.context.id) as AugustLockStatus;
    } else {
      lockStatus = await this.augustClient.unlock(this.accessory.context.id) as AugustLockStatus;
    }

    // Update current state based on the result
    this.accessory.context.LockCurrentState = lockStatus.state.locked ? 1 : 0;
    this.lockService.updateCharacteristic(this.platform.Characteristic.LockCurrentState, this.accessory.context.LockCurrentState);
  }
}