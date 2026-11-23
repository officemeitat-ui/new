import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import type { Reminder } from '../state';
/** Lokale Erinnerungen gibt es nur in der App am Handy, nicht im Browser. */
export const remindersSupported = Platform.OS !== 'web';

if (remindersSupported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

/**
 * Plant je Trainingstag eine wöchentliche Erinnerung und ersetzt alle bisherigen.
 * days: 0 = Montag … 6 = Sonntag.
 */
export async function syncReminders(reminder: Reminder, days: number[], name: string): Promise<'ok' | 'off' | 'denied' | 'unsupported' | 'error'> {
  if (!remindersSupported) return 'unsupported';
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    if (!reminder.on || !days.length) return 'off';
    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return 'denied';
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('training', { name: 'Trainingserinnerung', importance: Notifications.AndroidImportance.DEFAULT });
    }
    for (const day of days) {
      await Notifications.scheduleNotificationAsync({
        content: { title: 'Heute ist Trainingstag', body: `${name}, deine Einheit wartet. Die ersten zwei Übungen reichen zum Anfangen.` },
        // Expo zählt Wochentage ab Sonntag = 1.
        trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: ((day + 1) % 7) + 1, hour: reminder.hour, minute: reminder.minute, channelId: 'training' },
      });
    }
    return 'ok';
  } catch {
    return 'error';
  }
}
