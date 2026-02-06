import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet } from 'react-native';
import { ConfigScreen } from './src/screens/ConfigScreen';
import { EventSelectionScreen } from './src/screens/EventSelectionScreen';
import { PhotoUploadScreen } from './src/screens/PhotoUploadScreen';
import { loadConfig, saveConfig } from './src/utils/config';
import { ApiClient } from './src/utils/api';
import { Config, Event } from './src/types';

type Screen = 'config' | 'events' | 'upload';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('config');
  const [config, setConfig] = useState<Config | null>(null);
  const [apiClient, setApiClient] = useState<ApiClient | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);

  useEffect(() => {
    loadInitialConfig();
  }, []);

  const loadInitialConfig = async () => {
    const savedConfig = await loadConfig();
    setConfig(savedConfig);
    
    if (savedConfig.adminSecret) {
      const client = new ApiClient(savedConfig.apiEndpoint, savedConfig.adminSecret);
      setApiClient(client);
      setCurrentScreen('events');
    } else {
      setCurrentScreen('config');
    }
  };

  const handleSaveConfig = async (newConfig: Config) => {
    await saveConfig(newConfig);
    setConfig(newConfig);
    
    const client = new ApiClient(newConfig.apiEndpoint, newConfig.adminSecret);
    setApiClient(client);
    setCurrentScreen('events');
  };

  const handleSelectEvent = (event: Event) => {
    setSelectedEvent(event);
    setCurrentScreen('upload');
  };

  const handleBackToEvents = () => {
    setSelectedEvent(null);
    setCurrentScreen('events');
  };

  const handleShowSettings = () => {
    setCurrentScreen('config');
  };

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      
      {currentScreen === 'config' && config && (
        <ConfigScreen
          config={config}
          onSave={handleSaveConfig}
          onCancel={apiClient ? handleBackToEvents : undefined}
        />
      )}
      
      {currentScreen === 'events' && apiClient && (
        <EventSelectionScreen
          apiClient={apiClient}
          onSelectEvent={handleSelectEvent}
          onSettings={handleShowSettings}
        />
      )}
      
      {currentScreen === 'upload' && apiClient && selectedEvent && (
        <PhotoUploadScreen
          event={selectedEvent}
          apiClient={apiClient}
          onBack={handleBackToEvents}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
});
