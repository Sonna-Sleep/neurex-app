import { NativeModule, requireNativeModule } from 'expo';

declare class NeurexForegroundServiceModule extends NativeModule<{}> {}

export default requireNativeModule<NeurexForegroundServiceModule>('NeurexForegroundService');
