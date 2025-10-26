import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import path from 'path';
import { promises as fs } from 'fs';

// @ts-expect-error August API has no types
import August from 'august-api';

type AugustState = {
  installationId?: string;
  authorized: boolean;
}

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class ExampleHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
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
    this.accessories.set(accessory.UUID, accessory);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  async discoverDevices() {
    const locks = await this.augustClient.locks();
    console.log(JSON.stringify(locks, null, 2)); 
    /*
    // EXAMPLE ONLY
    // A real plugin you would discover accessories from the local network, cloud services
    // or a user-defined array in the platform config.
    const exampleDevices = [
      {
        exampleUniqueId: 'ABCD',
        exampleDisplayName: 'Bedroom',
      },
      {
        exampleUniqueId: 'EFGH',
        exampleDisplayName: 'Kitchen',
      },
      {
        // This is an example of a device which uses a Custom Service
        exampleUniqueId: 'IJKL',
        exampleDisplayName: 'Backyard',
        CustomService: 'AirPressureSensor',
      },
    ];

    // loop over the discovered devices and register each one if it has not already been registered
    for (const device of exampleDevices) {
      // generate a unique id for the accessory this should be generated from
      // something globally unique, but constant, for example, the device serial
      // number or MAC address
      const uuid = this.api.hap.uuid.generate(device.exampleUniqueId);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.get(uuid);

      if (existingAccessory) {
        // the accessory already exists
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. e.g.:
        // existingAccessory.context.device = device;
        // this.api.updatePlatformAccessories([existingAccessory]);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new ExamplePlatformAccessory(this, existingAccessory);

        // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, e.g.:
        // remove platform accessories when no longer present
        // this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
        // this.log.info('Removing existing accessory from cache:', existingAccessory.displayName);
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.info('Adding new accessory:', device.exampleDisplayName);

        // create a new accessory
        const accessory = new this.api.platformAccessory(device.exampleDisplayName, uuid);

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.device = device;

        // create the accessory handler for the newly create accessory
        // this is imported from `platformAccessory.ts`
        new ExamplePlatformAccessory(this, accessory);

        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

      // push into discoveredCacheUUIDs
      this.discoveredCacheUUIDs.push(uuid);
    }

    // you can also deal with accessories from the cache which are no longer present by removing them from Homebridge
    // for example, if your plugin logs into a cloud account to retrieve a device list, and a user has previously removed a device
    // from this cloud account, then this device will no longer be present in the device list but will still be in the Homebridge cache
    for (const [uuid, accessory] of this.accessories) {
      if (!this.discoveredCacheUUIDs.includes(uuid)) {
        this.log.info('Removing existing accessory from cache:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
    */
  }
}
