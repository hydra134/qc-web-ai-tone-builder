import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import App from './app/App';

const root = document.getElementById('root');

if (!root) {
  throw new Error('The application root element is missing.');
}

createRoot(root).render(
  <StrictMode>
    <MantineProvider defaultColorScheme="light">
      <Notifications />
      <App />
    </MantineProvider>
  </StrictMode>,
);
