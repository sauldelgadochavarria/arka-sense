/// Configuración del backend ArkaSense (base-saas).
class ApiConfig {
  /// Base URL del SaaS (sin slash final).
  /// - Emulador Android: http://10.0.2.2:4003
  /// - iOS sim / desktop: http://127.0.0.1:4003
  /// - Dispositivo físico: http://<IP-LAN>:4003
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://127.0.0.1:4003',
  );

  static const String apiPrefix = '/api/v1';

  static String get apiBase => '$baseUrl$apiPrefix';

  static const String appVersion = '1.0.0';
}
