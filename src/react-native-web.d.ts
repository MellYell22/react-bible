declare module 'react-native' {
  import * as React from 'react';

  type NativeWebProps = Record<string, any> & {
    children?: React.ReactNode;
    style?: any;
  };

  export const ActivityIndicator: React.ComponentType<NativeWebProps>;
  export const FlatList: React.ComponentType<NativeWebProps>;
  export const KeyboardAvoidingView: React.ComponentType<NativeWebProps>;
  export const Modal: React.ComponentType<NativeWebProps>;
  export const RefreshControl: React.ComponentType<NativeWebProps>;
  export const ScrollView: React.ComponentType<NativeWebProps>;
  export const Text: React.ComponentType<NativeWebProps>;
  export const TextInput: React.ComponentType<NativeWebProps>;
  export const TouchableOpacity: React.ComponentType<NativeWebProps>;
  export const View: React.ComponentType<NativeWebProps>;

  export const Alert: {
    alert: (title: string, message?: string, buttons?: any[], options?: any) => void;
  };

  export const Dimensions: {
    get: (dimension: 'window' | 'screen') => {
      width: number;
      height: number;
      scale: number;
      fontScale: number;
    };
  };

  export const Platform: {
    OS: string;
    select: <T>(specifics: {
      web?: T;
      ios?: T;
      android?: T;
      native?: T;
      default?: T;
    }) => T | undefined;
  };

  export const StyleSheet: {
    create: <T extends Record<string, any>>(styles: T) => T;
    flatten: (style?: any) => any;
  };
}
