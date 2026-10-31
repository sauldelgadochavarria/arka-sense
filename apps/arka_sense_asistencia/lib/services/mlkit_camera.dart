import 'dart:io';

import 'package:camera/camera.dart';
import 'package:flutter/services.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';

const _orientations = <DeviceOrientation, int>{
  DeviceOrientation.portraitUp: 0,
  DeviceOrientation.landscapeLeft: 90,
  DeviceOrientation.portraitDown: 180,
  DeviceOrientation.landscapeRight: 270,
};

/// Convierte un frame de la cámara al formato que lee ML Kit.
/// No recorta ni alinea: solo sirve para saber si hay cara y si sonríe.
InputImage? inputImageFromCamera(CameraImage image, CameraController controller) {
  final camera = controller.description;
  final rotation = _rotation(controller, camera);
  if (rotation == null) return null;

  final rawFormat = InputImageFormatValue.fromRawValue(image.format.raw);
  final plane = image.planes.first;
  final format = image.planes.length == 1
      ? (rawFormat ?? InputImageFormat.nv21)
      : InputImageFormat.yuv420;

  final bytes = image.planes.length == 1 ? plane.bytes : _concatPlanes(image.planes);
  return InputImage.fromBytes(
    bytes: bytes,
    metadata: InputImageMetadata(
      size: Size(image.width.toDouble(), image.height.toDouble()),
      rotation: rotation,
      format: format,
      bytesPerRow: plane.bytesPerRow,
    ),
  );
}

InputImageRotation? _rotation(CameraController controller, CameraDescription camera) {
  if (Platform.isIOS) {
    return InputImageRotationValue.fromRawValue(camera.sensorOrientation);
  }
  if (!Platform.isAndroid) return null;
  final compensation = _orientations[controller.value.deviceOrientation];
  if (compensation == null) return null;
  final turns = camera.lensDirection == CameraLensDirection.front
      ? (camera.sensorOrientation + compensation) % 360
      : (camera.sensorOrientation - compensation + 360) % 360;
  return InputImageRotationValue.fromRawValue(turns);
}

Uint8List _concatPlanes(List<Plane> planes) {
  final all = WriteBuffer();
  for (final plane in planes) {
    all.putUint8List(plane.bytes);
  }
  return all.done().buffer.asUint8List();
}

/// Cara estable y lo bastante grande. La sonrisa leve en este teléfono
/// no llega a 0.7; 0.35 alcanza para disparar y el servidor vuelve a medirla.
bool facePoseReady(Face face, {required bool wantSmile}) {
  final box = face.boundingBox;
  if (box.width < 80 || box.height < 80) return false;
  final smile = face.smilingProbability;
  if (wantSmile) return smile != null && smile >= 0.4;
  return smile == null || smile < 0.15;
}
