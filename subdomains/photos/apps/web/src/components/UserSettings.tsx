import React, { useState, useEffect } from 'react';
import { X, Sun, Moon, Folder, Users } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { getUserCollaborations, updateUserProfile } from '../api';

interface Collaboration {
  event_id: number;
  event_slug: string;
  event_name: string;
  can_upload: boolean;
  invited_at: string;
}

interface UserSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

const UserSettings: React.FC<UserSettingsProps> = ({ isOpen, onClose }) => {
  const { user, updateUser } = useAuth();
  const { theme, setTheme } = useTheme();
  const [name, setName] = useState(user?.name || '');
  const [collaborations, setCollaborations] = useState<Collaboration[]>([]);
  const [downloadPath, setDownloadPath] = useState<string>('');
  const [selectedPathOption, setSelectedPathOption] = useState<string>('');
  const [showCustomPath, setShowCustomPath] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'profile' | 'collaborations'>('profile');

  const isNative = Capacitor.isNativePlatform();

  const commonPaths = [
    { label: 'Downloads', value: '/storage/emulated/0/Download' },
    { label: 'Documents', value: '/storage/emulated/0/Documents' },
    { label: 'Pictures', value: '/storage/emulated/0/Pictures' },
    { label: 'DCIM', value: '/storage/emulated/0/DCIM' },
    { label: 'Custom', value: 'custom' },
  ];

  // Initialize/update name when modal opens or user.name changes
  useEffect(() => {
    console.log('[UserSettings] Effect triggered - isOpen:', isOpen, 'user:', user);
    if (isOpen && user) {
      console.log('[UserSettings] Setting name to:', user.name || '(empty string)');
      console.log('[UserSettings] Full user object:', JSON.stringify(user, null, 2));
      setName(user.name || '');
    }
  }, [isOpen, user?.name, user?.email]); // Watch user.name and user.email specifically

  useEffect(() => {
    if (isOpen) {
      console.log('[UserSettings] Modal opened');
      loadCollaborations();
      loadDownloadPath();
    }
  }, [isOpen]);

  const loadCollaborations = async () => {
    try {
      const data = await getUserCollaborations();
      setCollaborations(data.collaborations || []);
    } catch (error) {
      console.error('Failed to load collaborations:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadDownloadPath = async () => {
    if (isNative) {
      try {
        // Get the saved download path from localStorage
        const savedPath = localStorage.getItem('download_path');
        setDownloadPath(savedPath || '/storage/emulated/0/Download');
      } catch (error) {
        console.error('Failed to load download path:', error);
      }
    }
  };

  // Initialize selected path option based on current path
  useEffect(() => {
    if (isNative && downloadPath) {
      const matchingPath = commonPaths.find(p => p.value === downloadPath);
      if (matchingPath) {
        setSelectedPathOption(downloadPath);
        setShowCustomPath(false);
      } else {
        setSelectedPathOption('custom');
        setShowCustomPath(true);
      }
    }
  }, [downloadPath, isNative]);

  const handlePathOptionChange = (value: string) => {
    setSelectedPathOption(value);
    if (value === 'custom') {
      setShowCustomPath(true);
      // Keep current custom path or set empty
      if (!commonPaths.some(p => p.value === downloadPath)) {
        // Already a custom path, keep it
      } else {
        setDownloadPath('');
      }
    } else {
      setShowCustomPath(false);
      setDownloadPath(value);
    }
  };

  const handleBrowseFolder = async () => {
    try {
      const result = await FilePicker.pickDirectory();
      if (result.path) {
        setDownloadPath(result.path);
        setSelectedPathOption('custom');
        setShowCustomPath(true);
      }
    } catch (error) {
      console.error('Failed to pick folder:', error);
      if (error instanceof Error && !error.message?.includes('cancel')) {
        alert('Failed to select folder: ' + error.message);
      }
    }
  };

  const handleSaveDownloadPath = () => {
    if (!downloadPath.trim()) {
      alert('Path cannot be empty');
      return;
    }
    
    localStorage.setItem('download_path', downloadPath.trim());
    alert('Download location saved! This will be used for future downloads.');
  };

  const handleSaveName = async () => {
    if (!name.trim()) {
      alert('Name cannot be empty');
      return;
    }

    setSaving(true);
    try {
      console.log('[UserSettings] Saving name:', name.trim());
      const updatedUser = await updateUserProfile({ name: name.trim() });
      console.log('[UserSettings] Received updated user from API:', updatedUser);
      // Update user in context directly instead of refetching
      updateUser(updatedUser);
      alert('Name updated successfully!');
    } catch (error) {
      console.error('Failed to update name:', error);
      alert('Failed to update name. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">User Settings</h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 px-6">
          <button
            onClick={() => setActiveTab('profile')}
            className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
              activeTab === 'profile'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            Profile & Theme
          </button>
          <button
            onClick={() => setActiveTab('collaborations')}
            className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
              activeTab === 'collaborations'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            Collaborations
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'profile' && (
            <div className="space-y-6">
              {/* Theme Settings */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  Theme
                </label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setTheme('light')}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-all ${
                      theme === 'light'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400'
                        : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <Sun className="w-5 h-5" />
                    <span className="font-medium">Light</span>
                  </button>
                  <button
                    onClick={() => setTheme('dark')}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-all ${
                      theme === 'dark'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400'
                        : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <Moon className="w-5 h-5" />
                    <span className="font-medium">Dark</span>
                  </button>
                </div>
              </div>

              {/* Name Settings */}
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Display Name
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                  placeholder="Enter your display name"
                />
                <button
                  onClick={handleSaveName}
                  disabled={!name.trim() || saving || name === user?.name}
                  className="mt-2 w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  {saving ? 'Saving...' : 'Save Profile'}
                </button>
              </div>

              {/* Email (read-only) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={user?.email || ''}
                  disabled
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                />
              </div>

              {/* Download Location */}
              {isNative && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                    Download Location (Android)
                  </label>

                  {/* Path selection dropdown with Browse button */}
                  <div className="mb-3">
                    <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                      Select a folder
                    </label>
                    <div className="flex gap-2">
                      <select
                        value={selectedPathOption}
                        onChange={(e) => handlePathOptionChange(e.target.value)}
                        className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                      >
                        <option value="">Choose a folder...</option>
                        {commonPaths.map((path) => (
                          <option key={path.value} value={path.value}>
                            {path.label}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={handleBrowseFolder}
                        className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors flex items-center gap-2"
                      >
                        <Folder className="w-4 h-4" />
                        Browse
                      </button>
                    </div>
                  </div>

                  {/* Custom path input (only shown when "Custom" is selected) */}
                  {showCustomPath && (
                    <div className="mb-3">
                      <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                        Enter custom path
                      </label>
                      <div className="relative">
                        <Folder className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                          type="text"
                          value={downloadPath}
                          onChange={(e) => setDownloadPath(e.target.value)}
                          placeholder="/storage/emulated/0/YourFolder"
                          className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                        />
                      </div>
                    </div>
                  )}

                  {/* Current path display */}
                  <div className="mb-3 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Current download location:</p>
                    <p className="text-sm font-mono text-gray-900 dark:text-white break-all">
                      {downloadPath || 'Not set'}
                    </p>
                  </div>

                  <button
                    onClick={handleSaveDownloadPath}
                    disabled={!downloadPath.trim()}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                  >
                    Save Download Location
                  </button>
                  
                  <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                    <p className="text-xs text-blue-800 dark:text-blue-300 font-medium mb-1">
                      📌 Tip:
                    </p>
                    <p className="text-xs text-blue-700 dark:text-blue-400">
                      Use the Browse button to select any folder on your device, or manually enter a path.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'collaborations' && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Users className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                  Events You Can Collaborate On
                </h3>
              </div>

              {loading ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  Loading collaborations...
                </div>
              ) : collaborations.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  You don't have any collaborations yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {collaborations.map((collab) => (
                    <div
                      key={collab.event_id}
                      className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-medium text-gray-900 dark:text-white">
                            {collab.event_name}
                          </h4>
                          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            /{collab.event_slug}
                          </p>
                          <div className="flex items-center gap-4 mt-2">
                            {collab.can_upload && (
                              <span className="text-xs px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded">
                                Can Upload
                              </span>
                            )}
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              Invited {new Date(collab.invited_at).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <a
                          href={`/events/${collab.event_slug}`}
                          className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                        >
                          View Event
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default UserSettings;
