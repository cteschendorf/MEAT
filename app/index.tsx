import { Text } from 'react-native';

import { ShellScreen } from '@/ui/shell-screen';

export default function TodayScreen() {
  return (
    <ShellScreen title="Today">
      <Text selectable>Daily nutrition will live here.</Text>
    </ShellScreen>
  );
}
