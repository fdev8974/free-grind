// Copyright 2020-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use std::{
  borrow::Cow,
  collections::HashMap,
  ffi::{c_char, CStr},
  panic::AssertUnwindSafe,
  ptr::NonNull,
  sync::Mutex,
};

use http::{
  header::{CONTENT_LENGTH, CONTENT_TYPE, RANGE},
  Request, Response as HttpResponse, StatusCode, Version,
};
use objc2::{
  rc::Retained,
  runtime::{AnyClass, AnyObject, ClassBuilder, ProtocolObject},
  AllocAnyThread, ClassType, Message,
};
use objc2_foundation::{
  ns_string, NSData, NSError, NSHTTPURLResponse, NSMutableDictionary, NSObject, NSObjectProtocol,
  NSString, NSURL, NSUUID,
};
use objc2_web_kit::{WKURLSchemeHandler, WKURLSchemeTask};
use once_cell::sync::Lazy;

use crate::{
  stream::{unregister_stream, with_stream, STREAM_HEADER},
  wkwebview::WEBVIEW_STATE,
  RequestAsyncResponder, WryWebView,
};

const STREAM_PIECE: usize = 64 * 1024;

static TASK_STREAMS: Lazy<Mutex<HashMap<usize, u64>>> = Lazy::new(Default::default);

/// Where the body a range request expects begins, which a stream body is skipped to first,
/// as the Android WebView does for an intercepted range request.
fn range_start(request: &Request<Vec<u8>>) -> u64 {
  request
    .headers()
    .get(RANGE)
    .and_then(|value| value.to_str().ok()?.strip_prefix("bytes=")?.split_once('-'))
    .and_then(|(first, _)| first.parse().ok())
    .unwrap_or(0)
}

fn task_streams() -> std::sync::MutexGuard<'static, HashMap<usize, u64>> {
  TASK_STREAMS
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub fn create(name: &str) -> &AnyClass {
  unsafe {
    // Include the address of WEBVIEW_STATE in the class name so that each dylib in the process
    // gets its own ObjC class with method pointers into its own code and data segments.
    let unique_id = std::ptr::addr_of!(WEBVIEW_STATE) as usize;
    let scheme_name = format!("{name}URLSchemeHandler_{unique_id:x}\0");
    let scheme_name = CStr::from_bytes_with_nul(scheme_name.as_bytes()).unwrap();
    let cls = ClassBuilder::new(scheme_name, NSObject::class());
    match cls {
      Some(mut cls) => {
        cls.add_ivar::<*mut c_char>(c"webview_id");
        cls.add_ivar::<usize>(c"protocol_index");
        cls.add_method(
          objc2::sel!(webView:startURLSchemeTask:),
          start_task as extern "C" fn(_, _, _, _),
        );
        cls.add_method(
          objc2::sel!(webView:stopURLSchemeTask:),
          stop_task as extern "C" fn(_, _, _, _),
        );
        cls.register()
      }
      None => AnyClass::get(scheme_name).expect("Failed to get the class definition"),
    }
  }
}

// Task handler for custom protocol
extern "C" fn start_task(
  this: &AnyObject,
  _sel: objc2::runtime::Sel,
  webview: &WryWebView,
  task: &ProtocolObject<dyn WKURLSchemeTask>,
) {
  #[cfg(feature = "tracing")]
  let span =
    tracing::info_span!(parent: None, "wry::custom_protocol::handle", uri = tracing::field::Empty)
      .entered();

  let task_key = task.hash(); // hash by task object address
  let task_uuid = webview.add_custom_task_key(task_key);

  let ivar = this.class().instance_variable(c"webview_id").unwrap();
  let webview_id = unsafe {
    let webview_id_ptr: *mut c_char = *ivar.load(this);
    CStr::from_ptr(webview_id_ptr)
      .to_str()
      .ok()
      .unwrap_or_default()
  };

  let ivar = this.class().instance_variable(c"protocol_index").unwrap();
  let protocol_index: usize = unsafe { *ivar.load(this) };

  let function = WEBVIEW_STATE
    .read()
    .unwrap()
    .get(webview_id)
    .and_then(|v| v.protocol_ptrs.get(protocol_index))
    .cloned();

  if let Some(function) = function {
    // Get url request
    let request = unsafe { task.request() };
    let url = request.URL().unwrap();

    let uri = url.absoluteString().unwrap().to_string();

    #[cfg(feature = "tracing")]
    span.record("uri", uri.clone());

    // Get request method (GET, POST, PUT etc...)
    let method = request.HTTPMethod().unwrap().to_string();

    // Prepare our HttpRequest
    let mut http_request = Request::builder().uri(uri).method(method.as_str());

    // Get body
    let mut sent_form_body = Vec::new();
    let body = request.HTTPBody();
    let body_stream = request.HTTPBodyStream();
    if let Some(body) = body {
      sent_form_body = body.to_vec();
    } else if let Some(body_stream) = body_stream {
      body_stream.open();

      let mut buf = [0u8; 128];
      while body_stream.hasBytesAvailable() {
        let count =
          unsafe { body_stream.read_maxLength(NonNull::new(buf.as_mut_ptr()).unwrap(), buf.len()) };
        sent_form_body.extend_from_slice(&buf[..count as usize]);
      }

      body_stream.close();
    }

    // Extract all headers fields
    let all_headers = request.allHTTPHeaderFields();

    // get all our headers values and inject them in our request
    if let Some(all_headers) = all_headers {
      for current_header in all_headers.allKeys().iter() {
        let header_value = all_headers.valueForKey(&current_header).unwrap();
        // inject the header into the request
        http_request = http_request.header(current_header.to_string(), header_value.to_string());
      }
    }

    let respond_with_404 = || {
      let urlresponse = NSHTTPURLResponse::alloc();
      let response = NSHTTPURLResponse::initWithURL_statusCode_HTTPVersion_headerFields(
        urlresponse,
        &url,
        StatusCode::NOT_FOUND.as_u16().try_into().unwrap(),
        Some(&NSString::from_str(
          format!("{:#?}", Version::HTTP_11).as_str(),
        )),
        None,
      )
      .unwrap();
      unsafe {
        task.didReceiveResponse(&response);
        // Finish
        task.didFinish();
      }
    };

    fn check_webview_id_valid(webview_id: &str) -> crate::Result<()> {
      if !WEBVIEW_STATE.read().unwrap().contains_key(webview_id) {
        return Err(crate::Error::CustomProtocolTaskInvalid);
      }
      Ok(())
    }

    /// Task may not live longer than async custom protocol handler.
    ///
    /// There are roughly 2 ways to cause segfault:
    /// 1. Task has stopped. pointer of the task not valid anymore.
    /// 2. Task had stopped, but the pointer of the task has allocated to a new task.
    ///    Outdated custom handler may call to the new task instance and cause segfault.
    fn check_task_is_valid(
      webview: &WryWebView,
      task_key: usize,
      current_uuid: Retained<NSUUID>,
    ) -> crate::Result<()> {
      let latest_task_uuid = webview.get_custom_task_uuid(task_key);
      let Some(latest_uuid) = latest_task_uuid else {
        return Err(crate::Error::CustomProtocolTaskInvalid);
      };
      if latest_uuid != current_uuid {
        return Err(crate::Error::CustomProtocolTaskInvalid);
      }
      Ok(())
    }

    struct StreamedTask {
      task: Retained<ProtocolObject<dyn WKURLSchemeTask>>,
      webview: Retained<WryWebView>,
      task_key: usize,
      task_uuid: Retained<NSUUID>,
      webview_id: String,
    }

    // The task and webview are only touched through calls WebKit allows from any thread,
    // and every call is preceded by the same validity checks the buffered path makes.
    unsafe impl Send for StreamedTask {}

    impl StreamedTask {
      fn valid(&self) -> crate::Result<()> {
        check_webview_id_valid(&self.webview_id)?;
        check_task_is_valid(&self.webview, self.task_key, self.task_uuid.clone())
      }

      fn deliver(&self, bytes: &[u8]) -> crate::Result<()> {
        self.valid()?;
        let data = NSData::with_bytes(bytes);
        objc2::exception::catch(AssertUnwindSafe(|| unsafe {
          self.task.didReceiveData(&data);
        }))
        .map_err(|_e| crate::Error::CustomProtocolTaskInvalid)
      }

      fn end(&self, failed: bool) {
        if self.valid().is_err() {
          return;
        }
        let _ = objc2::exception::catch(AssertUnwindSafe(|| unsafe {
          if failed {
            let error = NSError::new(-1, ns_string!("wry.stream"));
            self.task.didFailWithError(&error);
          } else {
            self.task.didFinish();
          }
        }));
        self.webview.remove_custom_task_key(self.task_key);
      }
    }

    fn feed_stream(streamed: StreamedTask, id: u64, skip: u64) {
      task_streams().insert(streamed.task_key, id);
      std::thread::spawn(move || {
        let mut piece = vec![0u8; STREAM_PIECE];
        let mut skipped = 0;
        while skipped < skip {
          match with_stream(id, |stream| stream.skip(skip - skipped)) {
            Ok(0) | Err(_) => break,
            Ok(n) => skipped += n,
          }
        }
        let failed = skipped < skip
          || loop {
            match with_stream(id, |stream| stream.read(&mut piece)) {
              Ok(0) => break false,
              Ok(read) if streamed.deliver(&piece[..read]).is_ok() => {}
              _ => break true,
            }
          };
        task_streams().remove(&streamed.task_key);
        unregister_stream(id);
        streamed.end(failed);
      });
    }

    // send response
    match http_request.body(sent_form_body) {
      Ok(final_request) => {
        let skip = range_start(&final_request);
        let webview = webview.retain();
        let task = task.retain();
        let responder: Box<dyn FnOnce(HttpResponse<Cow<'static, [u8]>>)> =
          Box::new(move |sent_response| {
            // Consolidate checks before calling into `did*` methods.
            let validate = || -> crate::Result<()> {
              check_webview_id_valid(webview_id)?;
              check_task_is_valid(&webview, task_key, task_uuid.clone())?;
              Ok(())
            };

            let stream = sent_response
              .headers()
              .get(STREAM_HEADER)
              .and_then(|value| value.to_str().ok()?.parse::<u64>().ok());

            // Perform an upfront validation
            if let Err(_e) = validate() {
              if let Some(id) = stream {
                unregister_stream(id);
              }
              #[cfg(feature = "tracing")]
              tracing::warn!("Task invalid before sending response: {:?}", _e);
              return; // If invalid, return early without calling task methods.
            }

            fn response(
              // FIXME: though we give it a static lifetime, it's not guaranteed to be valid.
              task: Retained<ProtocolObject<dyn WKURLSchemeTask>>,
              // FIXME: though we give it a static lifetime, it's not guaranteed to be valid.
              webview: Retained<WryWebView>,
              task_key: usize,
              task_uuid: Retained<NSUUID>,
              webview_id: &str,
              url: Retained<NSURL>,
              sent_response: HttpResponse<Cow<'_, [u8]>>,
              stream: Option<u64>,
              skip: u64,
            ) -> crate::Result<()> {
              // Validate
              check_webview_id_valid(webview_id)?;
              check_task_is_valid(&webview, task_key, task_uuid.clone())?;

              let content_len = sent_response.body().len();
              // default: application/octet-stream, but should be provided by the client
              let wanted_mime = sent_response.headers().get(CONTENT_TYPE);
              // default to 200
              let wanted_status_code = sent_response.status().as_u16() as i32;
              // default to HTTP/1.1
              let wanted_version = format!("{:#?}", sent_response.version());

              let headers = NSMutableDictionary::new();
              if let Some(mime) = wanted_mime {
                headers.insert(
                  &*NSString::from_str(CONTENT_TYPE.as_str()),
                  &*NSString::from_str(mime.to_str().unwrap()),
                );
              }
              if stream.is_none() {
                headers.insert(
                  &*NSString::from_str(CONTENT_LENGTH.as_str()),
                  &*NSString::from_str(&content_len.to_string()),
                );
              }

              // add headers
              for (name, value) in sent_response.headers().iter() {
                if name.as_str() == STREAM_HEADER {
                  continue;
                }
                if let Ok(value) = value.to_str() {
                  headers.insert(
                    &*NSString::from_str(name.as_str()),
                    &*NSString::from_str(value),
                  );
                }
              }

              let urlresponse = NSHTTPURLResponse::alloc();
              let response = NSHTTPURLResponse::initWithURL_statusCode_HTTPVersion_headerFields(
                urlresponse,
                &url,
                wanted_status_code.try_into().unwrap(),
                Some(&NSString::from_str(&wanted_version)),
                Some(&headers),
              )
              .unwrap();

              // Re-validate before calling didReceiveResponse
              check_webview_id_valid(webview_id)?;
              check_task_is_valid(&webview, task_key, task_uuid.clone())?;

              // Use map_err to convert Option<Retained<Exception>> to crate::Error
              objc2::exception::catch(AssertUnwindSafe(|| unsafe {
                task.didReceiveResponse(&response);
              }))
              .map_err(|_e| crate::Error::CustomProtocolTaskInvalid)?;

              if let Some(id) = stream {
                feed_stream(
                  StreamedTask {
                    task,
                    webview,
                    task_key,
                    task_uuid,
                    webview_id: webview_id.to_owned(),
                  },
                  id,
                  skip,
                );
                return Ok(());
              }

              let data = match sent_response.into_body() {
                Cow::Owned(content) => NSData::from_vec(content),
                Cow::Borrowed(content) => NSData::with_bytes(content),
              };

              // Check validity again
              check_webview_id_valid(webview_id)?;
              check_task_is_valid(&webview, task_key, task_uuid.clone())?;

              objc2::exception::catch(AssertUnwindSafe(|| unsafe {
                task.didReceiveData(&data);
              }))
              .map_err(|_e| crate::Error::CustomProtocolTaskInvalid)?;

              check_webview_id_valid(webview_id)?;
              check_task_is_valid(&webview, task_key, task_uuid)?;

              objc2::exception::catch(AssertUnwindSafe(|| unsafe {
                task.didFinish();
              }))
              .map_err(|_e| crate::Error::CustomProtocolTaskInvalid)?;

              if WEBVIEW_STATE.read().unwrap().contains_key(webview_id) {
                webview.remove_custom_task_key(task_key);
                Ok(())
              } else {
                Err(crate::Error::CustomProtocolTaskInvalid)
              }
            }

            #[cfg(feature = "tracing")]
            let _span = tracing::info_span!("wry::custom_protocol::call_handler").entered();

            if let Err(_e) = response(
              task,
              webview,
              task_key,
              task_uuid,
              webview_id,
              url,
              sent_response,
              stream,
              skip,
            ) {
              if let Some(id) = stream {
                unregister_stream(id);
              }
              #[cfg(feature = "tracing")]
              tracing::error!("Error responding to task: {:?}", _e);
            }
          });

        #[cfg(feature = "tracing")]
        let _span = tracing::info_span!("wry::custom_protocol::call_handler").entered();

        function(
          webview_id,
          final_request,
          RequestAsyncResponder { responder },
        );
      }
      Err(_) => respond_with_404(),
    };
  } else {
    #[cfg(feature = "tracing")]
    tracing::warn!(
      "Either WebView or WebContext instance is dropped! This handler shouldn't be called."
    );
  };
}

extern "C" fn stop_task(
  _this: &ProtocolObject<dyn WKURLSchemeHandler>,
  _sel: objc2::runtime::Sel,
  webview: &WryWebView,
  task: &ProtocolObject<dyn WKURLSchemeTask>,
) {
  let task_key = task.hash();
  webview.remove_custom_task_key(task_key);
  if let Some(id) = task_streams().remove(&task_key) {
    unregister_stream(id);
  }
}
