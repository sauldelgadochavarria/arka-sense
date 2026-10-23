/// Configuración del backend ArkaSense (base-saas).
class ApiConfig {
  /// Base URL del SaaS (sin slash final).
  ///
  /// Compilar para teléfono físico:
  /// ```
  /// flutter build apk --release --dart-define=API_BASE_URL=http://TU_IP_LAN:4003
  /// ```
  /// - Emulador Android: http://10.0.2.2:4003
  /// - iOS sim / desktop: http://127.0.0.1:4003
  /// - Dispositivo físico: http://&lt;IP-LAN&gt;:4003  (127.0.0.1 = el teléfono, no el PC)
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://192.168.1.32:4003',
  );

  static const String apiPrefix = '/api/v1';

  static String get apiBase => '$baseUrl$apiPrefix';

  /// Debe coincidir con `version` en pubspec.yaml (sin build number).
  static const String appVersion = '1.1.0';
}
