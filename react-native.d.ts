declare module 'react-native' {
  import * as React from 'react';

  export class View extends React.Component<any> {}
  export class Text extends React.Component<any> {}
  export class TextInput extends React.Component<any> {}
  export class TouchableOpacity extends React.Component<any> {}
  export class ScrollView extends React.Component<any> {
    scrollTo(options?: any): void;
  }
  export class ActivityIndicator extends React.Component<any> {}
  export class RefreshControl extends React.Component<any> {}
  export class KeyboardAvoidingView extends React.Component<any> {}
  export class FlatList<ItemT = any> extends React.Component<any> {}
  export class Modal extends React.Component<any> {}

  export const Alert: {
    alert: (title: string, message?: string, buttons?: any[], options?: any) => void;
  };

  export const Dimensions: {
    get: (dimension: 'window' | 'screen') => { width: number; height: number; scale: number; fontScale: number };
  };

  export const Platform: {
    OS: 'web' | 'ios' | 'android' | 'windows' | 'macos' | string;
    select: <T>(specifics: Record<string, T>) => T;
  };

  export const StyleSheet: {
    create: <T extends Record<string, any>>(styles: T) => T;
    flatten: (style?: any) => any;
    absoluteFillObject: any;
  };
}
