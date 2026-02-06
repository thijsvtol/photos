import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { Config } from '../types';

interface ConfigScreenProps {
  config: Config;
  onSave: (config: Config) => void;
  onCancel?: () => void;
}

export const ConfigScreen: React.FC<ConfigScreenProps> = ({
  config,
  onSave,
  onCancel,
}) => {
  const [apiEndpoint, setApiEndpoint] = useState(config.apiEndpoint);
  const [adminSecret, setAdminSecret] = useState(config.adminSecret);

  const handleSave = () => {
    if (!apiEndpoint.trim()) {
      Alert.alert('Error', 'API endpoint is required');
      return;
    }
    if (!adminSecret.trim()) {
      Alert.alert('Error', 'Admin secret is required');
      return;
    }

    onSave({ apiEndpoint: apiEndpoint.trim(), adminSecret: adminSecret.trim() });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Configuration</Text>
      <Text style={styles.description}>
        Configure the API endpoint and admin credentials
      </Text>

      <View style={styles.form}>
        <Text style={styles.label}>API Endpoint</Text>
        <TextInput
          style={styles.input}
          value={apiEndpoint}
          onChangeText={setApiEndpoint}
          placeholder="https://photos.thijsvtol.nl"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>Admin Secret</Text>
        <TextInput
          style={styles.input}
          value={adminSecret}
          onChangeText={setAdminSecret}
          placeholder="Enter admin secret"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />

        <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
          <Text style={styles.saveButtonText}>Save Configuration</Text>
        </TouchableOpacity>

        {onCancel && (
          <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  description: {
    fontSize: 16,
    color: '#666',
    marginBottom: 30,
  },
  form: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 20,
    backgroundColor: '#fff',
  },
  saveButton: {
    backgroundColor: '#007AFF',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  cancelButton: {
    backgroundColor: '#f5f5f5',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  cancelButtonText: {
    color: '#333',
    fontSize: 18,
    fontWeight: '600',
  },
});
