import type { Preview } from '@storybook/react';
import { withThemeByClassName } from '@storybook/addon-themes';

// Load the root Sendero stylesheet so every story inherits the
// exact vermilion token set the shipping app uses.
import '@sendero/ui/globals.css';
import '../../app/app/globals.css';
import './storybook-shell.css';

const preview: Preview = {
  parameters: {
    layout: 'padded',
    backgrounds: {
      default: 'cream',
      values: [
        { name: 'cream', value: '#fafaf7' },
        { name: 'ink', value: '#fb542b' },
        { name: 'dark', value: '#0a0b0d' },
      ],
    },
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
    },
    a11y: {
      config: {
        rules: [{ id: 'color-contrast', enabled: true }],
      },
    },
  },
  decorators: [
    // Dark-mode toggle wired to the same `.dark` class the main app
    // uses — flipping the toolbar re-evaluates every CSS var.
    withThemeByClassName({
      themes: { light: '', dark: 'dark' },
      defaultTheme: 'light',
      parentSelector: 'html',
    }),
  ],
};

export default preview;
