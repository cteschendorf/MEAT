import { render } from '@testing-library/react-native';

import { BrandLockup } from '../src/ui/components/brand-lockup';

describe('production brand lockup', () => {
  it('renders the MEAT identity as accessible text with a decorative vector-derived mark', async () => {
    const view = await render(<BrandLockup />);
    expect(view.getByText('MEAT')).toBeTruthy();
    expect(view.queryByLabelText('MEAT logo')).toBeNull();
  });
});
