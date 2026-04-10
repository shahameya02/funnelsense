import { render, screen } from '@testing-library/react';
import App from './App';

test('renders FunnelSense heading', () => {
  render(<App />);
  const heading = screen.getByText(/FunnelSense/i);
  expect(heading).toBeInTheDocument();
});
