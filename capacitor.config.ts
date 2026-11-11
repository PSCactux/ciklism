import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cactux.megabici',
  appName: 'MegaBici',
  webDir: 'dist',
  backgroundColor: '#152820',
  // Native releases always bundle the same web build. No development server URL.
};
export default config;
