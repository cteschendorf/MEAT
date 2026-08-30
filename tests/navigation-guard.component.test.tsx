import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { useMutationRouteGuard } from '../src/ui/navigation/use-mutation-route-guard';

const mockSetOptions = jest.fn();
const mockUsePreventRemove = jest.fn();

jest.mock('expo-router', () => ({
  useNavigation: () => ({ setOptions: mockSetOptions }),
}));

jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: (blocked: boolean, callback: () => void) =>
    mockUsePreventRemove(blocked, callback),
}));

function GuardHarness({ blocked, onExit }: { blocked: boolean; onExit: () => void }) {
  const queueRouteExit = useMutationRouteGuard(blocked);
  return (
    <Pressable accessibilityRole="button" onPress={() => queueRouteExit(onExit)}>
      <Text>Finish action</Text>
    </Pressable>
  );
}

describe('mutation route guard', () => {
  beforeEach(() => {
    mockSetOptions.mockClear();
    mockUsePreventRemove.mockClear();
  });

  it('holds successful navigation until native removal prevention is released', async () => {
    const onExit = jest.fn();
    const screen = await render(<GuardHarness blocked onExit={onExit} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Finish action' }));
    expect(onExit).not.toHaveBeenCalled();
    expect(mockUsePreventRemove).toHaveBeenLastCalledWith(true, expect.any(Function));

    await screen.rerender(<GuardHarness blocked={false} onExit={onExit} />);
    await waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
    expect(mockUsePreventRemove).toHaveBeenLastCalledWith(false, expect.any(Function));
    expect(mockSetOptions).toHaveBeenCalledWith({ headerBackButtonMenuEnabled: false });
  });
});
