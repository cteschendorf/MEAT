import { TabStack } from '@/ui/navigation/tab-stack';

export const unstable_settings = { anchor: 'friends' };

export default function FriendsLayout() {
  return <TabStack screenName="friends" />;
}
