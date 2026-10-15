import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'app.dart';
import 'services/auth_state.dart';
import 'services/reminder_scheduler.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Init notificaciones (no bloquea si falla)
  try {
    await ReminderScheduler.instance.init();
  } catch (e) {
    debugPrint('[main] reminders init: $e');
  }

  final auth = AuthState();
  runApp(
    ChangeNotifierProvider(
      create: (_) => auth..bootstrap().then((_) async {
        if (auth.isAuthenticated) {
          await ReminderScheduler.instance.syncFromApi(auth);
        } else {
          await ReminderScheduler.instance.rescheduleFromCache();
        }
      }),
      child: const ArkaSenseApp(),
    ),
  );
}
