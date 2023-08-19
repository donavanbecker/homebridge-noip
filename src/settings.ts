import { PlatformConfig } from 'homebridge';
/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = 'NoIP';

/**
 * This must match the name of your plugin as defined the package.json
 */
export const PLUGIN_NAME = 'homebridge-noip';

//Config
export interface NoIPPlatformConfig extends PlatformConfig {
  devices?: Array<DevicesConfig>;
  refreshRate?: number;
  logging?: string;
}

export type DevicesConfig = {
  hostname?: string[];
  username?: string;
  password?: string;
  firmware?: number;
  refreshRate?: number;
  logging?: string;
  delete?: boolean;
};
