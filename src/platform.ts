import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import path from 'path';
import { promises as fs } from 'fs';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

// @ts-expect-error August API has no types
import August from 'august-api';
import { AugustAPILockDetailed, AugustLockContext } from './types.js';
import { AugustLockAccessory } from './lockAccessory.js';

type AugustState = {
  installationId?: string;
  authorized: boolean;
}

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class AugustLockPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: Map<string, PlatformAccessory<AugustLockContext>> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];

  private state: AugustState = { authorized: false };

  private augustClient: August | null = null;

  private configPath = '';

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.configPath = path.join(this.api.user.storagePath(), 'august-lock', 'state.json');

    this.api.on('didFinishLaunching', async () => {
      await this.loadOrInitState();

      if( !this.state.installationId ) {
        this.state.installationId = this.api.hap.uuid.generate(this.config.accountId as string);
        this.log.info('Generated new installationId:', this.state.installationId);
      }

      this.augustClient = new August({
        installId: this.state.installationId,
        augustId: this.config.accountId as string,
        password: this.config.accountPassword as string,
      });

      if( !this.state.authorized ) {
        if( this.config.authCode ) {
          const success = await this.augustClient.validate(this.config.authCode);

          if( success ) {
            this.log.info('Successfully authorized with August API');
            this.state.authorized = true;
            await this.saveState();
          } else {
            this.log.error('Failed to authorize with August API - please check your 2FA code and try again');
          }
        } else {
          this.log.info('Initiating auth flow with August API');
          const success = await this.augustClient.authorize();
          if( success ) {
            this.log.info('Authorization code sent to your email. Please add the code to the config and restart Homebridge to complete authorization.');
          } else {
            this.log.error('Failed to initiate authorization with August API - please check your account ID and password');
          }
        }

        return;
      }

      if( this.state.authorized ) {
        this.discoverDevices();
      }
    });

    this.api.on('shutdown', async () => {
      this.saveState();
    });
  }

  async saveState(){
    this.log.debug('Saving state to:', this.configPath);
    await fs.writeFile(this.configPath, JSON.stringify(this.state, null, 2), 'utf-8');
  }

  async loadOrInitState(){
    try {
      await fs.access(this.configPath);
    } catch (e) {
      this.log.debug('No existing state, initializing new state at:', this.configPath);
      await fs.mkdir(path.dirname(this.configPath), { recursive: true });
      await fs.writeFile(this.configPath, JSON.stringify({}), 'utf-8');
    }

    this.log.debug('Loading state from:', this.configPath);
    this.state = JSON.parse(await fs.readFile(this.configPath, 'utf-8'));
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to set up event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache, so we can track if it has already been registered
    this.accessories.set(accessory.UUID, accessory as PlatformAccessory<AugustLockContext>);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  async discoverDevices() {
    const locksDetails = await this.augustClient.details() as AugustAPILockDetailed[];
    // console.log(JSON.stringify(locksDetails, null, 2));
    const locks = locksDetails.map((lock) => {
      const lockState = lock.LockStatus.status === 'locked' ? 1 : 0;
      return {
        id: lock.LockID,
        name: lock.LockName,
        LockCurrentState: lockState,
        LockTargetState: lockState,
        BatteryLevel: Math.round(lock.batteryInfo.level * 100),
        serial: lock.SerialNumber,
        model: lock.skuNumber,
      } satisfies AugustLockContext;
    });

    this.log.debug(`Discovered locks:\n${JSON.stringify(locks, null, 2)}`);

    for (const lock of locks) {
      const uuid = this.api.hap.uuid.generate(lock.id);

      const existingAccessory = this.accessories.get(uuid);
      
      if (existingAccessory) {
        this.log.info(`Restoring existing lock from cache: ${lock.name} (${lock.id})`);
        // update context
        existingAccessory.context = lock;
        this.api.updatePlatformAccessories([existingAccessory]);

        new AugustLockAccessory(this, existingAccessory, this.augustClient);
      } else {
        this.log.info(`Adding new lock: ${lock.name} (${lock.id})`);

        const accessory = new this.api.platformAccessory<AugustLockContext>(lock.name, uuid);
        accessory.context = lock;

        new AugustLockAccessory(this, accessory, this.augustClient);

        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

      this.discoveredCacheUUIDs.push(uuid);
    }

    for (const [uuid, accessory] of this.accessories) {
      if (!this.discoveredCacheUUIDs.includes(uuid)) {
        this.log.info('Removing old accessory from cache:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }
}
