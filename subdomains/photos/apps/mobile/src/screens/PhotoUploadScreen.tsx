import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Image,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { Event, UploadQueueItem } from '../types';
import { UploadManager } from '../utils/uploadManager';
import { ApiClient } from '../utils/api';

interface PhotoUploadScreenProps {
  event: Event;
  apiClient: ApiClient;
  onBack: () => void;
}

export const PhotoUploadScreen: React.FC<PhotoUploadScreenProps> = ({
  event,
  apiClient,
  onBack,
}) => {
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const uploadManager = new UploadManager(apiClient);

  useEffect(() => {
    requestPermissions();
  }, []);

  const requestPermissions = async () => {
    const { status: mediaStatus } = await MediaLibrary.requestPermissionsAsync();
    const { status: cameraStatus } = await ImagePicker.requestCameraPermissionsAsync();
    
    if (mediaStatus !== 'granted' || cameraStatus !== 'granted') {
      Alert.alert(
        'Permissions Required',
        'This app needs access to your photos and camera to upload images.'
      );
    }
  };

  const pickPhotos = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 1,
        exif: true,
      });

      if (!result.canceled && result.assets) {
        const newItems: UploadQueueItem[] = result.assets.map((asset) => ({
          id: `photo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          uri: asset.uri,
          filename: asset.fileName || `photo-${Date.now()}.jpg`,
          eventSlug: event.slug,
          status: 'pending',
          progress: 0,
          width: asset.width,
          height: asset.height,
          exif: asset.exif,
        }));

        setUploadQueue((prev) => [...prev, ...newItems]);
      }
    } catch (error) {
      console.error('Error picking photos:', error);
      Alert.alert('Error', 'Failed to pick photos');
    }
  };

  const startUpload = async () => {
    const pendingItems = uploadQueue.filter((item) => item.status === 'pending');
    if (pendingItems.length === 0) {
      Alert.alert('Info', 'No photos to upload');
      return;
    }

    setUploading(true);

    for (const item of pendingItems) {
      try {
        // Update status to uploading
        updateItemStatus(item.id, 'uploading', 0);

        // Upload the photo
        await uploadManager.uploadPhoto(item, (progress) => {
          updateItemStatus(item.id, 'uploading', progress);
        });

        // Mark as completed
        updateItemStatus(item.id, 'completed', 100);
      } catch (error) {
        console.error('Upload failed for item:', item.id, error);
        updateItemStatus(item.id, 'failed', 0, (error as Error).message);
      }
    }

    setUploading(false);
    
    const failedCount = uploadQueue.filter((item) => item.status === 'failed').length;
    const successCount = uploadQueue.filter((item) => item.status === 'completed').length;
    
    Alert.alert(
      'Upload Complete',
      `Successfully uploaded ${successCount} photo(s)${failedCount > 0 ? `, ${failedCount} failed` : ''}`
    );
  };

  const updateItemStatus = (
    id: string,
    status: UploadQueueItem['status'],
    progress: number,
    error?: string
  ) => {
    setUploadQueue((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, status, progress, error } : item
      )
    );
  };

  const removeItem = (id: string) => {
    setUploadQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const clearCompleted = () => {
    setUploadQueue((prev) =>
      prev.filter((item) => item.status !== 'completed')
    );
  };

  const renderItem = ({ item }: { item: UploadQueueItem }) => (
    <View style={styles.photoCard}>
      <Image source={{ uri: item.uri }} style={styles.thumbnail} />
      <View style={styles.photoInfo}>
        <Text style={styles.filename} numberOfLines={1}>
          {item.filename}
        </Text>
        <View style={styles.statusRow}>
          {item.status === 'uploading' && (
            <View style={styles.progressContainer}>
              <View
                style={[styles.progressBar, { width: `${item.progress}%` }]}
              />
              <Text style={styles.progressText}>{Math.round(item.progress)}%</Text>
            </View>
          )}
          {item.status === 'completed' && (
            <Text style={styles.statusCompleted}>✓ Uploaded</Text>
          )}
          {item.status === 'failed' && (
            <Text style={styles.statusFailed}>✗ Failed</Text>
          )}
          {item.status === 'pending' && (
            <Text style={styles.statusPending}>Pending</Text>
          )}
        </View>
      </View>
      {item.status !== 'uploading' && (
        <TouchableOpacity
          onPress={() => removeItem(item.id)}
          style={styles.removeButton}
        >
          <Text style={styles.removeButtonText}>✕</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const pendingCount = uploadQueue.filter((item) => item.status === 'pending').length;
  const completedCount = uploadQueue.filter((item) => item.status === 'completed').length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.eventName}>{event.name}</Text>
          <Text style={styles.subtitle}>Upload Photos</Text>
        </View>
      </View>

      <View style={styles.stats}>
        <Text style={styles.statsText}>
          {uploadQueue.length} photo(s) • {pendingCount} pending • {completedCount} completed
        </Text>
      </View>

      <FlatList
        data={uploadQueue}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No photos selected</Text>
            <Text style={styles.emptySubtext}>
              Tap "Select Photos" to choose photos from your library
            </Text>
          </View>
        }
      />

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.button, styles.selectButton]}
          onPress={pickPhotos}
          disabled={uploading}
        >
          <Text style={styles.buttonText}>📷 Select Photos</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.button,
            styles.uploadButton,
            (uploading || pendingCount === 0) && styles.buttonDisabled,
          ]}
          onPress={startUpload}
          disabled={uploading || pendingCount === 0}
        >
          {uploading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>
              ⬆️ Upload {pendingCount > 0 ? `(${pendingCount})` : ''}
            </Text>
          )}
        </TouchableOpacity>

        {completedCount > 0 && (
          <TouchableOpacity
            style={[styles.button, styles.clearButton]}
            onPress={clearCompleted}
            disabled={uploading}
          >
            <Text style={styles.clearButtonText}>Clear Completed</Text>
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
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    paddingTop: 60,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    marginRight: 15,
  },
  backButtonText: {
    fontSize: 16,
    color: '#007AFF',
  },
  eventName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
  },
  stats: {
    padding: 15,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  statsText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  listContent: {
    padding: 15,
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#999',
    marginBottom: 10,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  photoCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 10,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  thumbnail: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#e0e0e0',
  },
  photoInfo: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  filename: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
    marginBottom: 5,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressContainer: {
    flex: 1,
    height: 20,
    backgroundColor: '#e0e0e0',
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
  },
  progressBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#007AFF',
  },
  progressText: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    textAlign: 'center',
    lineHeight: 20,
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
  },
  statusCompleted: {
    fontSize: 14,
    color: '#34C759',
    fontWeight: '600',
  },
  statusFailed: {
    fontSize: 14,
    color: '#FF3B30',
    fontWeight: '600',
  },
  statusPending: {
    fontSize: 14,
    color: '#999',
  },
  removeButton: {
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  removeButtonText: {
    fontSize: 20,
    color: '#999',
  },
  actions: {
    padding: 15,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  button: {
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  selectButton: {
    backgroundColor: '#5856D6',
  },
  uploadButton: {
    backgroundColor: '#007AFF',
  },
  clearButton: {
    backgroundColor: '#f5f5f5',
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  clearButtonText: {
    color: '#333',
    fontSize: 16,
    fontWeight: '600',
  },
});
