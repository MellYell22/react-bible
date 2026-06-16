declare module 'react-native' {
  import * as React from 'react';

  export class View extends React.Component<any> {}
  export class Text extends React.Component<any> {}
  export class TouchableOpacity extends React.Component<any> {}
  export class ActivityIndicator extends React.Component<any> {}
  export class TextInput extends React.Component<any> {}
  export class ScrollView extends React.Component<any> {
    scrollTo(options?: any): void;
    getInnerViewNode(): any;
  }
  export class RefreshControl extends React.Component<any> {}
  export class KeyboardAvoidingView extends React.Component<any> {}
  export class FlatList<ItemT = any> extends React.Component<any> {}
  export class Modal extends React.Component<any> {}

  export const Platform: {
    OS: 'web' | 'ios' | 'android' | string;
    select: <T>(specifics: Record<string, T>) => T | undefined;
  };

  export const Alert: {
    alert: (...args: any[]) => void;
  };

  export const StyleSheet: {
    create: <T extends Record<string, any>>(styles: T) => T;
    flatten: (style?: any) => any;
  };
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  readonly results: SpeechRecognitionResultList;
}
