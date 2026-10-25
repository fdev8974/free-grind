import SwiftRs
import Tauri
import UIKit
import WebKit

private class NoInputAccessoryView: UIView {
    override var inputAccessoryView: UIView? { nil }
}

extension WKWebView {
    func hideInputAccessoryView() {
        guard let target = findContentView(in: self) else { return }

        let baseClassName = String(describing: type(of: target))
        let noAccessoryClassName = "\(baseClassName)_NoInputAccessory"

        var patchedClass: AnyClass? = NSClassFromString(noAccessoryClassName)
        if patchedClass == nil {
            guard let targetClass = object_getClass(target),
                let nameCString = noAccessoryClassName.cString(using: .utf8),
                let allocatedClass = objc_allocateClassPair(targetClass, nameCString, 0)
            else {
                return
            }
            if let method = class_getInstanceMethod(
                NoInputAccessoryView.self,
                #selector(getter: NoInputAccessoryView.inputAccessoryView)
            ) {
                class_addMethod(
                    allocatedClass,
                    #selector(getter: UIResponder.inputAccessoryView),
                    method_getImplementation(method),
                    method_getTypeEncoding(method)
                )
            }
            objc_registerClassPair(allocatedClass)
            patchedClass = allocatedClass
        }

        if let patchedClass = patchedClass {
            object_setClass(target, patchedClass)
        }
    }

    private func findContentView(in view: UIView) -> UIView? {
        if String(describing: type(of: view)).hasPrefix("WKContent") {
            return view
        }
        for subview in view.subviews {
            if let found = findContentView(in: subview) {
                return found
            }
        }
        return nil
    }
}

class KeyboardFixPlugin: Plugin {
    private var keyboardObserver: NSObjectProtocol?
    private weak var patchedWebView: WKWebView?

    @objc public override func load(webview: WKWebView) {
        patchedWebView = webview

        // Not keyboard related, but this is the app's WKWebView setup: the
        // page's own scrolling shows UIKit's scroll indicators, which CSS
        // can't hide (index.css only covers inner scroll containers). Native
        // apps show none, so neither does the app — same as on Android.
        webview.scrollView.showsVerticalScrollIndicator = false
        webview.scrollView.showsHorizontalScrollIndicator = false

        keyboardObserver = NotificationCenter.default.addObserver(
            forName: UIResponder.keyboardWillShowNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.patchedWebView?.hideInputAccessoryView()
        }

        DispatchQueue.main.async { [weak self] in
            self?.patchedWebView?.hideInputAccessoryView()
        }
    }

    deinit {
        if let keyboardObserver = keyboardObserver {
            NotificationCenter.default.removeObserver(keyboardObserver)
        }
    }
}

@_cdecl("init_plugin_ios_keyboard_fix")
func initPlugin() -> Plugin {
    return KeyboardFixPlugin()
}
