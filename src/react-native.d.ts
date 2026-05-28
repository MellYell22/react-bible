declare module 'react-native' {
  import * as React from 'react';

  export type StyleProp<T = any> = T | T[] | null | undefined;
  export type ViewStyle = Record<string, any>;
  export type TextStyle = Record<string, any>;
  export type ImageStyle = Record<string, any>;

  export class View extends React.Component<any> {
    measureLayout(...args: any[]): void;
  }
  export class Text extends React.Component<any> {}
  export class TouchableOpacity extends React.Component<any> {}
  export class ScrollView extends React.Component<any> {
    scrollTo(...args: any[]): void;
    scrollToEnd(...args: any[]): void;
    getInnerViewNode(): any;
  }
  export class TextInput extends React.Component<any> {}
  export class ActivityIndicator extends React.Component<any> {}
  export class RefreshControl extends React.Component<any> {}
  export class KeyboardAvoidingView extends React.Component<any> {}
  export class FlatList<ItemT = any> extends React.Component<any> {}
  export class Modal extends React.Component<any> {}

  export const Alert: {
    alert: (...args: any[]) => void;
  };

  export const Dimensions: {
    get: (dimension: 'window' | 'screen') => { width: number; height: number; scale: number; fontScale: number };
  };

  export const Platform: {
    OS: string;
    select: <T>(specifics: Record<string, T>) => T | undefined;
  };

  export const StyleSheet: {
    create: <T extends Record<string, any>>(styles: T) => T;
    flatten: (...styles: any[]) => any;
    absoluteFillObject: Record<string, any>;
  };
}
