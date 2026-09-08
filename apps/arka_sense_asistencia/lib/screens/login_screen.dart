import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api_client.dart';
import '../services/auth_state.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _account = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  bool _loadingCreds = true;
  bool _rememberPassword = false;
  bool _obscurePassword = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadSaved());
  }

  Future<void> _loadSaved() async {
    final saved = await context.read<AuthState>().loadSavedCredentials();
    if (!mounted) return;
    if (saved != null) {
      _account.text = saved.account.isNotEmpty ? saved.account : 'empresa-demo';
      _email.text = saved.email;
      _rememberPassword = saved.rememberPassword;
      if (saved.rememberPassword && (saved.password?.isNotEmpty ?? false)) {
        _password.text = saved.password!;
      }
    } else {
      _account.text = 'empresa-demo';
    }
    setState(() => _loadingCreds = false);
  }

  @override
  void dispose() {
    _account.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await context.read<AuthState>().login(
            account: _account.text,
            email: _email.text,
            password: _password.text,
            rememberPassword: _rememberPassword,
          );
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: _loadingCreds
                ? const Padding(
                    padding: EdgeInsets.all(48),
                    child: Center(child: CircularProgressIndicator()),
                  )
                : ListView(
                    padding: const EdgeInsets.all(24),
                    children: [
                      const SizedBox(height: 24),
                      Text(
                        'ArkaSense',
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.headlineLarge?.copyWith(
                              color: const Color(0xFF2FD4A1),
                              fontWeight: FontWeight.w800,
                            ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Asistencia',
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(
                              color: Colors.white70,
                            ),
                      ),
                      const SizedBox(height: 32),
                      TextField(
                        controller: _account,
                        decoration: const InputDecoration(
                          labelText: 'Cuenta (tenant)',
                          hintText: 'empresa-demo',
                        ),
                        textInputAction: TextInputAction.next,
                        autofillHints: const [AutofillHints.organizationName],
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: _email,
                        decoration: const InputDecoration(labelText: 'Email'),
                        keyboardType: TextInputType.emailAddress,
                        textInputAction: TextInputAction.next,
                        autofillHints: const [AutofillHints.username, AutofillHints.email],
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: _password,
                        decoration: InputDecoration(
                          labelText: 'Contraseña',
                          suffixIcon: IconButton(
                            tooltip: _obscurePassword ? 'Mostrar' : 'Ocultar',
                            onPressed: () =>
                                setState(() => _obscurePassword = !_obscurePassword),
                            icon: Icon(
                              _obscurePassword ? Icons.visibility : Icons.visibility_off,
                            ),
                          ),
                        ),
                        obscureText: _obscurePassword,
                        autofillHints: const [AutofillHints.password],
                        onSubmitted: (_) => _busy ? null : _submit(),
                      ),
                      const SizedBox(height: 8),
                      CheckboxListTile(
                        value: _rememberPassword,
                        onChanged: _busy
                            ? null
                            : (v) => setState(() => _rememberPassword = v ?? false),
                        controlAffinity: ListTileControlAffinity.leading,
                        contentPadding: EdgeInsets.zero,
                        title: const Text('Recordar contraseña en este dispositivo'),
                        subtitle: const Text(
                          'La cuenta y el email se guardan siempre. La contraseña solo si marcas esta opción.',
                          style: TextStyle(fontSize: 12, color: Colors.white54),
                        ),
                      ),
                      if (_error != null) ...[
                        const SizedBox(height: 8),
                        Text(_error!, style: const TextStyle(color: Colors.orangeAccent)),
                      ],
                      const SizedBox(height: 16),
                      FilledButton(
                        onPressed: _busy ? null : _submit,
                        child: _busy
                            ? const SizedBox(
                                height: 22,
                                width: 22,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Text('Iniciar sesión'),
                      ),
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}
