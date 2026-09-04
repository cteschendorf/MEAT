import type { ReactNode } from 'react';
import { Animated, KeyboardAvoidingView, Platform, type StyleProp, type ViewStyle } from 'react-native';

import { useKeyboardInset } from '@/ui/composer/use-keyboard-inset';

export interface ComposerKeyboardAvoiderProps {
  readonly style: StyleProp<ViewStyle>;
  readonly children: ReactNode;
}

/**
 * Keeps the sheet's footer — and the search field it carries — above the
 * keyboard.
 *
 * iOS gets a bottom padding driven directly by the keyboard's own reported
 * height (`useKeyboardInset`) rather than `KeyboardAvoidingView`'s usual
 * position-measuring, because that measurement is unreliable on a screen
 * that was just pushed onto a native stack — see `useKeyboardInset` for why.
 *
 * Android is untouched: `adjustResize` already shrinks the window, and
 * `KeyboardAvoidingView` with `behavior="height"` on top of that is the
 * pairing this composer shipped with before the search field ever went
 * missing on iOS, so there is nothing here to fix on that platform.
 */
export function ComposerKeyboardAvoider({ style, children }: ComposerKeyboardAvoiderProps) {
  const keyboardInset = useKeyboardInset();

  if (Platform.OS === 'android') {
    return (
      <KeyboardAvoidingView behavior="height" style={style}>
        {children}
      </KeyboardAvoidingView>
    );
  }

  return <Animated.View style={[style, { paddingBottom: keyboardInset }]}>{children}</Animated.View>;
}
