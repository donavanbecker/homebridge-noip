/* eslint-disable max-len */
import { Service, PlatformAccessory, CharacteristicValue, IPv4Address } from 'homebridge';
import { NoIPPlatform } from '../platform';
import { interval, throwError } from 'rxjs';
import { skipWhile, timeout } from 'rxjs/operators';
import { request } from 'undici';
import { Context } from 'vm';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class ContactSensor {
  // Services
  private service: Service;

  // Characteristic Values
  ContactSensorState!: CharacteristicValue;

  // Others
  interval: any;
  ip!: IPv4Address;

  // Config
  deviceRefreshRate!: any;

  // Updates
  SensorUpdateInProgress!: boolean;
  response!: string;

  constructor(private readonly platform: NoIPPlatform, private accessory: PlatformAccessory, public device) {
    // default placeholders
    this.ContactSensorState = this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;

    // this is subject we use to track when we need to POST changes to the NoIP API
    this.SensorUpdateInProgress = false;

    // set accessory information
    accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'No-IP')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.serialNumber)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, this.FirmwareRevision(accessory, device))
      .getCharacteristic(this.platform.Characteristic.FirmwareRevision)
      .updateValue(this.FirmwareRevision(accessory, device));

    // get the LightBulb service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory
    (this.service = this.accessory.getService(this.platform.Service.ContactSensor) || this.accessory.addService(this.platform.Service.ContactSensor)),
    accessory.displayName;

    // To avoid "Cannot add a Service with the same UUID another Service without aCSo defining a unique 'subtype' property." error,
    // when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
    // this.accessory.getService('NAME') ?? this.accessory.addService(this.platform.Service.Lightbulb, 'NAME', 'USER_DEFINED_SUBTYPE');

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/

    // Retrieve initial values and updateHomekit
    this.refreshStatus();
    this.updateHomeKitCharacteristics();

    // Start an update interval
    this.interval = interval(this.platform.config.refreshRate! * 1000)
      .pipe(skipWhile(() => this.SensorUpdateInProgress))
      .subscribe(() => {
        this.refreshStatus();
      });
  }

  /**
   * Parse the device status from the noip api
   */
  parseStatus() {
    if (this.response.includes('nochg')) {
      this.ContactSensorState = this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED;
    } else {
      this.ContactSensorState = this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
    }
    this.platform.debugLog(`Contact Sensor: ${this.accessory.displayName} ContactSensorState: ${this.ContactSensorState}`);
  }

  /**
   * Asks the NoIP API for the latest device information
   */
  async refreshStatus() {
    try {
      const { body, statusCode, headers } = await request('https://dynupdate.no-ip.com/nic/update', {
        method: 'GET',
        headers: [JSON.stringify(this.platform.generateHeaders())],
      });
      this.response = await body.text();
      this.platform.log.warn(`Response: ${JSON.stringify(this.response)}`);
      this.platform.log.warn(`Status Code: ${JSON.stringify(statusCode)}`);
      this.platform.log.warn(`Headers: ${JSON.stringify(headers)}`);

      //this.response = await this.platform.axios.get('https://dynupdate.no-ip.com/nic/update', this.options);
      this.platform.debugLog(`Contact Sensor: ${this.accessory.displayName} respsonse: ${JSON.stringify(this.response)}`);
      const data = this.response.trim();
      const f = data.match(/good|nochg/g);
      if (f) {
        this.platform.debugLog(`Contact Sensor: ${this.accessory.displayName}, ${f[0]}`);
        this.status(f, data);
      } else {
        this.platform.errorLog(`Contact Sensor: ${this.accessory.displayName} error: ${data}`);
      }
      this.parseStatus();
      this.updateHomeKitCharacteristics();
    } catch (e: any) {
      this.platform.errorLog(`Contact Sensor: ${this.accessory.displayName} failed to update status, Error Message: ${JSON.stringify(e.message)}`);
      this.platform.debugLog(`Contact Sensor: ${this.accessory.displayName}, Error: ${JSON.stringify(e)}`);
      this.apiError(e);
    }
  }

  private status(f: any, data: any) {
    switch (f[0]) {
      case 'nochg':
        this.platform.debugLog(`Contact Sensor: ${this.accessory.displayName}'s IP Address has not updated, IP Address: ${data.split(' ')[1]}`);
        break;
      case 'good':
        this.platform.warnLog(`Contact Sensor: ${this.accessory.displayName}'s IP Address has been updated, IP Address: ${data.split(' ')[1]}`);
        break;
      case 'nohost':
        this.platform.errorLog(
          'Hostname supplied does not exist under specified account, ' +
            'client exit and require user to enter new login credentials before performing an additional request.',
        );
        this.timeout();
        break;
      case 'badauth':
        this.platform.errorLog('Invalid username password combination.');
        this.timeout();
        break;
      case 'badagent':
        this.platform.errorLog('Client disabled. Client should exit and not perform any more updates without user intervention. ');
        this.timeout();
        break;
      case '!donator':
        this.platform.errorLog(
          'An update request was sent, ' + 'including a feature that is not available to that particular user such as offline options.',
        );
        this.timeout();
        break;
      case 'abuse':
        this.platform.errorLog(
          'Username is blocked due to abuse. ' +
            'Either for not following our update specifications or disabled due to violation of the No-IP terms of service. ' +
            'Our terms of service can be viewed [here](https://www.noip.com/legal/tos). Client should stop sending updates.',
        );
        this.timeout();
        break;
      case '911':
        this.platform.errorLog('A fatal error on our side such as a database outage. Retry the update no sooner than 30 minutes. ');
        this.timeout();
        break;
      default:
        this.platform.debugLog(data);
    }
  }

  private timeout() {
    this.interval
      .pipe(
        timeout({
          each: 1000,
          with: () => throwError(() => new Error('nohost')),
        }),
      )
      .subscribe({
        error: this.platform.errorLog,
      });
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  updateHomeKitCharacteristics() {
    if (this.ContactSensorState === undefined) {
      this.platform.debugLog(`Contact Sensor: ${this.accessory.displayName} ContactSensorState: ${this.ContactSensorState}`);
    } else {
      this.service.updateCharacteristic(this.platform.Characteristic.ContactSensorState, this.ContactSensorState);
      this.platform.debugLog(`Contact Sensor: ${this.accessory.displayName} updateCharacteristic ContactSensorState: ${this.ContactSensorState}`);
    }
  }

  public apiError(e: any) {
    this.service.updateCharacteristic(this.platform.Characteristic.ContactSensorState, e);
  }

  FirmwareRevision(accessory: PlatformAccessory<Context>, device: { firmware: string; }): CharacteristicValue {
    let FirmwareRevision: string;
    this.platform.log.debug(`Contact Sensor: ${this.accessory.displayName}`
    + ` accessory.context.FirmwareRevision: ${accessory.context.FirmwareRevision}`);
    this.platform.log.debug(`$Contact Sensor: ${this.accessory.displayName} device.firmware: ${device.firmware}`);
    this.platform.log.debug(`Contact Sensor: ${this.accessory.displayName} this.platform.version: ${this.platform.version}`);
    if (accessory.context.FirmwareRevision) {
      FirmwareRevision = accessory.context.FirmwareRevision;
    } else if (device.firmware) {
      FirmwareRevision = device.firmware;
    } else {
      FirmwareRevision = this.platform.version;
    }
    return FirmwareRevision;
  }
}
