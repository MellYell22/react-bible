/**
 * `react-native` is never installed here — vite.config.ts aliases it to
 * `react-native-web` at build time, and react-native-web ships no TypeScript
 * declarations of its own. Without this, tsc could not resolve the module and
 * `npm run lint` failed with ~34 TS2307 errors plus ~28 cascading TS2339s,
 * which made `npm run check` useless as a pre-deploy gate.
 *
 * Trade-off, stated plainly: this buys back type-checking for the rest of the
 * codebase (api/, lib/, services, hooks) at the cost of real types on the RN
 * component surface — which was never actually type-checked anyway, because
 * the module did not resolve at all. To get genuine types, install typings
 * matching react-native-web and delete this file.
 *
 * Components that appear in type position (`useRef<ScrollView>`) are declared
 * as classes so they provide both a value and a type binding; a shorthand
 * `declare module` alone yields TS2709 at those call sites.
 */
declare module 'react-native' {
  import type * as React from 'react';

  export class View extends React.Component<any> {
    measureLayout(...args: any[]): void;
    measure(...args: any[]): void;
    measureInWindow(...args: any[]): void;
  }
  export class ScrollView extends React.Component<any> {
    scrollTo(...args: any[]): void;
    scrollToEnd(...args: any[]): void;
  }
  export class TextInput extends React.Component<any> {
    focus(): void;
    blur(): void;
    clear(): void;
  }
  export class FlatList extends React.Component<any> {
    scrollToEnd(...args: any[]): void;
    scrollToIndex(...args: any[]): void;
    scrollToOffset(...args: any[]): void;
  }
  export class Modal extends React.Component<any> {}
  export class KeyboardAvoidingView extends React.Component<any> {}
  export class RefreshControl extends React.Component<any> {}
  export class ActivityIndicator extends React.Component<any> {}
  export class Pressable extends React.Component<any> {}
  export class TouchableOpacity extends React.Component<any> {}
  export class Image extends React.Component<any> {}
  export const Linking: { openURL(url: string): Promise<void> };
  export class Text extends React.Component<any> {}

  export const StyleSheet: any;
  export const Platform: any;
  export const Alert: any;
  export const Dimensions: any;
  export function useWindowDimensions(): { width: number; height: number; scale: number; fontScale: number };

  const _default: any;
  export default _default;
}
