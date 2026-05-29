declare module 'react-native' {
  import type * as React from 'react';

  export type StyleProp<T = any> = T | T[] | null | undefined;

  export class ActivityIndicator extends React.Component<any> {}
  export class FlatList extends React.Component<any> {}
  export class KeyboardAvoidingView extends React.Component<any> {}
  export class Modal extends React.Component<any> {}
  export class RefreshControl extends React.Component<any> {}
  export class ScrollView extends React.Component<any> {
    scrollTo: (...args: any[]) => void;
    getInnerViewNode: () => any;
  }
  export class Text extends React.Component<any> {}
  export class TextInput extends React.Component<any> {}
  export class TouchableOpacity extends React.Component<any> {}
  export class View extends React.Component<any> {
    measureLayout: (...args: any[]) => void;
  }

  export const Alert: {
    alert: (...args: any[]) => void;
  };

  export const Dimensions: {
    get: (dimension: 'window' | 'screen') => { width: number; height: number; scale: number; fontScale: number };
  };

  export const Platform: {
    OS: string;
    select: <T>(specifics: Record<string, T>) => T;
  };

  export const StyleSheet: {
    create: <T extends Record<string, any>>(styles: T) => T;
    flatten: (style?: StyleProp) => any;
    hairlineWidth: number;
    absoluteFillObject: Record<string, any>;
  };
}
