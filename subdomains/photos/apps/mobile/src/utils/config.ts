import AsyncStorage from '@react-native-async-storage/async-storage';
import { Config } from '../types';

const CONFIG_KEY = '@photos_config';

const DEFAULT_CONFIG: Config = {
  apiEndpoint: 'https://photos.thijsvtol.nl',
  adminSecret: '',
};

export const loadConfig = async (): Promise<Config> => {
  try {
    const stored = await AsyncStorage.getItem(CONFIG_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('Failed to load config:', error);
  }
  return DEFAULT_CONFIG;
};

export const saveConfig = async (config: Config): Promise<void> => {
  try {
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch (error) {
    console.error('Failed to save config:', error);
    throw error;
  }
};
