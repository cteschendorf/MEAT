import { TabStack } from '@/ui/navigation/tab-stack';

export const unstable_settings = { anchor: 'me' };

export default function MeLayout() {
  return <TabStack screenName="me" />;
}
