declare module 'react-native' {
  import * as React from 'react';

  export type StyleProp<T = any> = T | T[] | null | undefined;
  export type ViewStyle = Record<string, any>;
  export type TextStyle = Record<string, any>;
  export type ImageStyle = Record<string, any>;
  export type NativeSyntheticEvent<T = any> = { nativeEvent: T };
  export type LayoutChangeEvent = NativeSyntheticEvent<{
    layout: { x: number; y: number; width: number; height: number };
  }>;

  export interface BaseProps {
    children?: React.ReactNode;
    style?: StyleProp;
    [key: string]: any;
  }

  export class View extends React.Component<BaseProps> {
    measureLayout: (
      relativeToNativeNode: any,
      onSuccess: (x: number, y: number, width: number, height: number) => void,
      onFail?: () => void,
    ) => void;
  }

  export const Text: React.ComponentType<BaseProps>;
  export const TouchableOpacity: React.ComponentType<BaseProps>;
  export const TextInput: React.ComponentType<BaseProps>;
  export const ActivityIndicator: React.ComponentType<BaseProps>;
  export const Modal: React.ComponentType<BaseProps>;
  export const RefreshControl: React.ComponentType<BaseProps>;
  export const KeyboardAvoidingView: React.ComponentType<BaseProps>;

  export class ScrollView extends React.Component<BaseProps> {
    scrollTo: (options?: { x?: number; y?: number; animated?: boolean } | number, y?: number, animated?: boolean) => void;
    scrollToEnd: (options?: { animated?: boolean }) => void;
    getInnerViewNode: () => any;
  }

  export class FlatList<ItemT = any> extends React.Component<BaseProps & {
    data?: readonly ItemT[] | null;
    renderItem?: (info: { item: ItemT; index: number }) => React.ReactElement | null;
    keyExtractor?: (item: ItemT, index: number) => string;
  }> {}

  export const StyleSheet: {
    create<T extends Record<string, any>>(styles: T): T;
    flatten(style?: StyleProp): any;
    hairlineWidth: number;
    absoluteFillObject: Record<string, any>;
  };

  export const Platform: {
    OS: 'web' | 'ios' | 'android' | 'windows' | 'macos';
    select<T>(specifics: { web?: T; ios?: T; android?: T; default?: T; [platform: string]: T | undefined }): T | undefined;
  };

  export const Dimensions: {
    get(dimension: 'window' | 'screen'): { width: number; height: number; scale: number; fontScale: number };
  };

  export const Alert: {
    alert: (title: string, message?: string, buttons?: Array<Record<string, any>>, options?: Record<string, any>) => void;
  };
}
