import { useEffect, useState } from 'react';
import { Animated, Keyboard, Platform } from 'react-native';

/**
 * How far the keyboard currently reaches up from the bottom of the screen,
 * animated in step with its own show/hide transition. Zero when the keyboard
 * is closed, or on Android — see below.
 *
 * `KeyboardAvoidingView` (behavior `"padding"`) derives this itself by
 * measuring the avoiding view's own position in the window at the moment the
 * keyboard event fires, then subtracting. That measurement is a snapshot of
 * whatever layout happened to be current, and the composer is a screen that
 * has just been pushed onto a native stack — it can still be mid-transition,
 * or the pushed screen's frame can still read as the previous screen's, when
 * the keyboard opens a beat later. When that race loses, the computed offset
 * comes out short (occasionally zero), which is what "the search box
 * disappears under the keyboard" looks like from the outside: nothing is
 * technically wrong with the field, `KeyboardAvoidingView` just measured a
 * frame that no longer describes where the screen actually is.
 *
 * Tracking the keyboard's own reported height sidesteps that: there is
 * nothing to measure, so there is nothing for a mid-transition layout to get
 * wrong.
 *
 * iOS only. Android resizes the whole window when the keyboard opens
 * (`adjustResize`, Expo's managed default), so a caller adding this on top
 * there would be compensating twice; Android composers should keep using
 * `KeyboardAvoidingView` with `behavior="height"` instead, same as before.
 */
export function useKeyboardInset(): Animated.Value {
  // Lazy `useState` rather than `useRef`: the value is read during render (it
  // feeds straight into a style prop), and refs are not meant to be.
  const [inset] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    // Will* fires before the keyboard finishes animating in, which is what
    // lets this track its motion instead of snapping after the fact.
    const show = Keyboard.addListener('keyboardWillShow', (event) => {
      Animated.timing(inset, {
        toValue: event.endCoordinates.height,
        duration: event.duration || 250,
        useNativeDriver: false,
      }).start();
    });
    const hide = Keyboard.addListener('keyboardWillHide', (event) => {
      Animated.timing(inset, {
        toValue: 0,
        duration: event.duration || 250,
        useNativeDriver: false,
      }).start();
    });

    return () => {
      show.remove();
      hide.remove();
    };
  }, [inset]);

  return inset;
}
