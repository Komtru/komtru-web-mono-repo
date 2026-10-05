import type { Preview } from '@storybook/react-vite';
import './preview.css';

const preview: Preview = {
  parameters: {
    // Every screen in the reference is drawn in a 340px mobile web frame; stories read best at that
    // width, so the story canvas keeps the padding off and lets each story set its own.
    layout: 'padded',
    controls: { expanded: true },
  },
};

export default preview;
