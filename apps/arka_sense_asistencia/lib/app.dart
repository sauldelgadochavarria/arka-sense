import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'services/auth_state.dart';

class ArkaSenseApp extends StatelessWidget {
  const ArkaSenseApp({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthState>();
    return MaterialApp(
      title: 'ArkaSense Asistencia',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF2FD4A1),
          brightness: Brightness.dark,
          primary: const Color(0xFF2FD4A1),
        ),
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFF071316),
        inputDecorationTheme: const InputDecorationTheme(
          border: OutlineInputBorder(),
        ),
      ),
      home: auth.loading
          ? const Scaffold(body: Center(child: CircularProgressIndicator()))
          : (auth.isAuthenticated ? const HomeScreen() : const LoginScreen()),
    );
  }
}
