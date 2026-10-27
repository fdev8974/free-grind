// Copyright 2020-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use std::{
  io,
  panic::{catch_unwind, AssertUnwindSafe},
};

use jni::{
  objects::{JByteArray, JClass},
  sys::{jbyte, jint, jlong, jsize},
  JNIEnv,
};
use crate::stream::{unregister_stream, with_stream};

fn guarded<T>(
  env: &mut JNIEnv,
  sentinel: T,
  body: impl FnOnce(&mut JNIEnv) -> io::Result<T>,
) -> T {
  match catch_unwind(AssertUnwindSafe(|| body(env))) {
    Ok(Ok(value)) => value,
    Ok(Err(error)) => {
      throw(env, &error.to_string());
      sentinel
    }
    Err(_) => {
      throw(env, "stream panicked");
      sentinel
    }
  }
}

fn throw(env: &mut JNIEnv, message: &str) {
  if env.exception_check().unwrap_or(true) {
    return;
  }
  let _ = env.throw_new("java/io/IOException", message);
}

fn read_bounds(capacity: jsize, offset: jint, length: jint) -> io::Result<(jsize, usize)> {
  match offset.checked_add(length) {
    Some(end) if offset >= 0 && length >= 0 && end <= capacity => Ok((offset, length as usize)),
    _ => Err(io::Error::new(
      io::ErrorKind::InvalidInput,
      "read range outside the buffer",
    )),
  }
}

fn as_jbytes(bytes: &[u8]) -> &[jbyte] {
  unsafe { std::slice::from_raw_parts(bytes.as_ptr().cast::<jbyte>(), bytes.len()) }
}

#[allow(non_snake_case)]
pub unsafe fn streamAvailable(mut env: JNIEnv, _: JClass, handle: jlong) -> jint {
  guarded(&mut env, 0, |_| {
    with_stream(handle as u64, |stream| stream.available()).map(|n| n.min(jint::MAX as u64) as jint)
  })
}

#[allow(non_snake_case)]
pub unsafe fn streamSkip(mut env: JNIEnv, _: JClass, handle: jlong, n: jlong) -> jlong {
  guarded(&mut env, 0, |_| {
    if n <= 0 {
      return Ok(0);
    }
    with_stream(handle as u64, |stream| stream.skip(n as u64))
      .map(|skipped| skipped.min(jlong::MAX as u64) as jlong)
  })
}

#[allow(non_snake_case)]
pub unsafe fn streamRead(
  mut env: JNIEnv,
  _: JClass,
  handle: jlong,
  buffer: JByteArray,
  offset: jint,
  length: jint,
) -> jint {
  guarded(&mut env, -1, |env| {
    let capacity = env.get_array_length(&buffer).map_err(io::Error::other)?;
    let (offset, length) = read_bounds(capacity, offset, length)?;
    if length == 0 {
      return Ok(0);
    }
    let mut chunk = vec![0u8; length];
    let read = with_stream(handle as u64, |stream| stream.read(&mut chunk))?;
    if read == 0 {
      return Ok(-1);
    }
    env
      .set_byte_array_region(&buffer, offset, as_jbytes(&chunk[..read]))
      .map_err(io::Error::other)?;
    Ok(read as jint)
  })
}

#[allow(non_snake_case)]
pub unsafe fn streamClose(mut env: JNIEnv, _: JClass, handle: jlong) {
  guarded(&mut env, (), |_| {
    unregister_stream(handle as u64);
    Ok(())
  })
}
