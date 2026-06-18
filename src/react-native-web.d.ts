declare module 'react-native' {
  import * as React from 'react';

  export type StyleProp<T = Record<string, unknown>> = T | T[] | null | undefined;
  export type ViewStyle = Record<string, unknown>;
  export type TextStyle = Record<string, unknown>;
  export type ImageStyle = Record<string, unknown>;

  export class View extends React.Component<any> {
    measureLayout: (...args: any[]) => void;
  }
  export class Text extends React.Component<any> {}
  export class TextInput extends React.Component<any> {}
  export class TouchableOpacity extends React.Component<any> {}
  export class ScrollView extends React.Component<any> {
    scrollTo: (...args: any[]) => void;
    scrollToEnd: (...args: any[]) => void;
    getInnerViewNode: () => any;
  }
  export class ActivityIndicator extends React.Component<any> {}
  export class FlatList<ItemT = any> extends React.Component<any> {}
  export class KeyboardAvoidingView extends React.Component<any> {}
  export class RefreshControl extends React.Component<any> {}
  export class Modal extends React.Component<any> {}

  export const Alert: {
    alert: (...args: any[]) => void;
  };

  export const Dimensions: {
    get: (dimension: string) => {
      width: number;
      height: number;
      scale: number;
      fontScale: number;
    };
    addEventListener: (...args: any[]) => { remove?: () => void };
  };

  export const Platform: {
    OS: string;
    select: <T>(specifics: Record<string, T>) => T | undefined;
  };

  export const StyleSheet: {
    create: <T extends Record<string, any>>(styles: T) => T;
    flatten: (style: any) => any;
    hairlineWidth: number;
    absoluteFillObject: Record<string, unknown>;
  };
}
